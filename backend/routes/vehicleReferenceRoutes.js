import express from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import asyncHandler from 'express-async-handler';
import {
  getVehicleDataFromS3,
  saveVehicleDataToS3,
  getVehicleReferenceColumnsFromS3,
  saveVehicleReferenceColumnsToS3,
  getHiddenBuiltinColumnsFromS3,
  saveHiddenBuiltinColumnsToS3,
  getBuiltinColumnLabelsFromS3,
  saveBuiltinColumnLabelsToS3,
  saveDataToS3,
} from '../utils/s3Storage.js';
import {
  FUEL_TYPES,
  normalizeFuel,
  normalizeBody,
  parseYearRange,
  parseTyreSize,
  isCatalogWorkbook,
  parseCatalogSheet,
  findCatalogMatch,
  pricedView,
} from '../utils/vehicleCatalog.js';
import crypto from 'crypto';
import { protect, admin } from '../middleware/authMiddleware.js';
import { emitEntitySync } from '../utils/syncService.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Fixed columns that already exist as dedicated fields — dynamic columns
// may not reuse these keys.
const RESERVED_PRICE_KEYS = new Set([
  'bridgestone', 'yokohama', 'apollo', 'michelin', 'dummy2', 'dummy',
  'amaron', 'exide',
]);

// Single source of truth for the 8 built-in brand columns, so the "hide
// built-in column" feature can look one up by key without re-deriving it
// from field names scattered across the file.
const BUILTIN_COLUMNS = [
  { key: 'bridgestone', label: 'Bridgestone', category: 'tyre', fieldName: 'tyre_price_bridgestone' },
  { key: 'yokohama', label: 'Yokohama', category: 'tyre', fieldName: 'tyre_price_yokohama' },
  { key: 'apollo', label: 'Apollo', category: 'tyre', fieldName: 'tyre_price_apollo' },
  { key: 'michelin', label: 'Michelin', category: 'tyre', fieldName: 'tyre_price_michelin' },
  { key: 'dummy2', label: 'Dummy 2', category: 'tyre', fieldName: 'tyre_price_dummy2' },
  { key: 'dummy', label: 'Dummy', category: 'tyre', fieldName: 'tyre_price_dummy' },
  { key: 'amaron', label: 'Amaron', category: 'battery', fieldName: 'battery_price_amaron' },
  { key: 'exide', label: 'Exide', category: 'battery', fieldName: 'battery_price_exide' },
];

const CATEGORY_PREFIX = {
  tyre: 'tyre_price_',
  battery: 'battery_price_',
};

const slugifyBrandKey = (label) => String(label || '').trim().toLowerCase().replace(/\s+/g, '');

const fieldNameForColumn = (category, key) => `${CATEGORY_PREFIX[category]}${key}`;

// Only ever merge safe, plain scalar fields into stored records — blocks
// prototype pollution and any accidental overwrite of internal metadata.
const RESERVED_RECORD_KEYS = new Set(['_id', 'createdAt', 'updatedAt', '__proto__', 'constructor', 'prototype']);
const SAFE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/i;

// Legacy-format imports: same normalisation as the catalogue (adds CNG/Hybrid).
const normalizeFuelType = normalizeFuel;

const extractDynamicFields = (body, knownKeys) => {
  const extra = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (knownKeys.has(key)) continue;
    if (RESERVED_RECORD_KEYS.has(key)) continue;
    if (!SAFE_KEY_PATTERN.test(key)) continue;
    if (value != null && typeof value !== 'string' && typeof value !== 'number') continue;
    extra[key] = value;
  }
  return extra;
};

// @desc    Import vehicle reference data from Excel
// @route   POST /api/vehicle-reference/import
// @access  Private/Admin
router.post('/import', protect, admin, upload.single('file'), asyncHandler(async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload an Excel file' });
    }

    console.log('File received:', req.file.originalname, 'Size:', req.file.size);

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Get raw rows to find the header row
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    if (rawRows.length < 1) {
      return res.status(400).json({ message: 'Excel file is empty' });
    }

    console.log('Total raw rows found:', rawRows.length);

    // ---- Carzzi catalogue workbook (Brand / Model / Variant / Year Range / …) ----
    // The workbook is the master list, so it REPLACES the whole catalogue
    // (the previous data is backed up to S3 first) instead of merging.
    if (isCatalogWorkbook((rawRows[0] || []).map((h) => String(h || '')))) {
      const { records, tyreColumns, errors } = parseCatalogSheet(rawRows);
      if (records.length === 0) {
        return res.status(400).json({ message: 'No vehicle rows found in the workbook', errors: errors.slice(0, 20) });
      }

      const previous = await getVehicleDataFromS3();
      const backupKey = `backups/vehicle_reference_data_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      if (previous.length) await saveDataToS3(backupKey, previous);

      const now = new Date().toISOString();
      const data = records.map((r) => ({ _id: crypto.randomUUID(), ...r, createdAt: now, updatedAt: now }));
      await saveVehicleDataToS3(data);

      // Tyre pattern columns come straight from the sheet; there are no
      // battery price columns any more (battery is quoted by Carzzi), and the
      // old built-in brand columns have no data, so hide all of them.
      const columns = tyreColumns.map(({ header, ...c }) => ({ ...c, createdAt: now }));
      await saveVehicleReferenceColumnsToS3(columns);
      await saveHiddenBuiltinColumnsToS3(BUILTIN_COLUMNS.map((c) => c.key));
      emitEntitySync('vehicle_reference_column', 'updated', { columns });
      emitEntitySync('vehicle_reference', 'updated', { replaced: true, count: data.length });

      return res.status(200).json({
        message: `Catalogue replaced: ${data.length} vehicles, ${columns.length} tyre price columns`,
        count: data.length,
        replacedCount: previous.length,
        backupKey: previous.length ? backupKey : null,
        warnings: errors.slice(0, 50),
      });
    }

    // Find header row (the one containing "brand_name" or "brand_model" or "Model")
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
      const row = rawRows[i];
      if (Array.isArray(row)) {
        const rowString = row.join(' ').toLowerCase();
        if (rowString.includes('brand_name') || rowString.includes('brand_model') || rowString.includes('model')) {
          headerRowIndex = i;
          console.log(`Header row found at index: ${i}, Headers:`, row);
          break;
        }
      }
    }

    if (headerRowIndex === -1) {
      console.warn('Header row not found, falling back to index 0');
      headerRowIndex = 0;
    }

    const headers = rawRows[headerRowIndex].map(h => h ? String(h).trim() : '');
    const dataRows = rawRows.slice(headerRowIndex + 1);

    console.log(`Processing ${dataRows.length} data rows with headers:`, headers);

    // Admin-defined extra brand columns — matched against the sheet by
    // either their field name (e.g. tyre_price_continental) or their
    // display label (e.g. "Continental"), same fuzzy normalization as the
    // built-in columns below.
    const dynamicColumns = await getVehicleReferenceColumnsFromS3();

    // Sheets name each tyre brand's variants as "Brand_Variant" columns
    // (e.g. "Bridgestone_Turanza", "Yokohama_Blue Earth-GT") and battery
    // brands as "battery_price_Brand" (e.g. "battery_price_Bosch") — any
    // such column not already a built-in or a previously-registered
    // dynamic column would otherwise be silently dropped on import. Detect
    // and auto-register them here so their price data is captured too.
    const KNOWN_TYRE_BRAND_PREFIXES = ['Bridgestone', 'Yokohama', 'Apollo'];
    const slugAlnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const titleCaseVariant = (raw) =>
      String(raw || '')
        .replace(/[_\-.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map((word) =>
          // Leave words that already have their own capitalization/digits
          // (e.g. "XP", "4G", "GT") alone — only capitalize plain lowercase ones.
          /^[a-z]+$/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word
        )
        .join(' ');

    // Every existing dynamic column is a tyre/battery brand column (that's
    // all this list is ever used for — see the category check in POST
    // /columns above), so each import fully resyncs it from the uploaded
    // sheet: the label/key/fieldName always come fresh from the sheet's
    // own header text (never preserved from a prior stored entry — that
    // would let a stale or wrong label from an earlier import linger
    // forever), and any dynamic column from a previous upload that this
    // sheet no longer has is dropped, rather than accumulating stale brand
    // columns across re-uploads.
    const existingByFieldName = new Map(dynamicColumns.map((c) => [c.fieldName, c]));
    const builtinFieldNames = new Set(BUILTIN_COLUMNS.map((c) => c.fieldName));
    // original header text -> canonical fieldName, for headers whose
    // punctuation (dots, hyphens, "+") makes plain fuzzy matching unreliable.
    const headerFieldMap = new Map();
    const sheetColumns = [];
    const seenFieldNames = new Set();

    for (const header of headers) {
      if (!header) continue;

      let fieldName;
      let freshColumn;

      const brandPrefix = KNOWN_TYRE_BRAND_PREFIXES.find((b) =>
        header.toLowerCase().startsWith(`${b.toLowerCase()}_`)
      );
      if (brandPrefix) {
        const variantRaw = header.slice(brandPrefix.length + 1);
        fieldName = `tyre_price_${slugAlnum(brandPrefix)}${slugAlnum(variantRaw)}`;
        freshColumn = {
          key: `${slugAlnum(brandPrefix)}${slugAlnum(variantRaw)}`,
          label: `${brandPrefix} ${titleCaseVariant(variantRaw)}`,
          category: 'tyre',
          fieldName,
          createdAt: new Date().toISOString(),
        };
      } else {
        const batteryMatch = /^battery[_\s]?price[_\s](.+)$/i.exec(header);
        if (batteryMatch) {
          const brandRaw = batteryMatch[1];
          fieldName = `battery_price_${slugAlnum(brandRaw)}`;
          freshColumn = {
            key: slugAlnum(brandRaw),
            label: titleCaseVariant(brandRaw),
            category: 'battery',
            fieldName,
            createdAt: new Date().toISOString(),
          };
        }
      }

      if (!fieldName || builtinFieldNames.has(fieldName)) continue;

      headerFieldMap.set(header, fieldName);
      if (seenFieldNames.has(fieldName)) continue;
      seenFieldNames.add(fieldName);
      // Always use the freshly-derived label/key from this sheet's header
      // text, only carrying over the original createdAt if this column
      // already existed.
      const existing = existingByFieldName.get(fieldName);
      sheetColumns.push(
        existing ? { ...freshColumn, createdAt: existing.createdAt } : freshColumn
      );
    }

    const removedColumns = dynamicColumns.filter((c) => !seenFieldNames.has(c.fieldName));
    const addedColumns = sheetColumns.filter((c) => !existingByFieldName.has(c.fieldName));

    const allDynamicColumns = sheetColumns;
    await saveVehicleReferenceColumnsToS3(allDynamicColumns);
    addedColumns.forEach((col) => emitEntitySync('vehicle_reference_column', 'created', col));
    removedColumns.forEach((col) =>
      emitEntitySync('vehicle_reference_column', 'deleted', { category: col.category, key: col.key })
    );
    console.log(
      `Resynced brand columns from sheet: ${addedColumns.length} added, ${removedColumns.length} removed, ${allDynamicColumns.length} total.`
    );

    // Built-in columns (Bridgestone, Yokohama, Apollo, Michelin, Dummy,
    // Dummy 2, Amaron, Exide) can't be removed by an import — they're
    // hardcoded — but if this sheet has no column for one at all, auto-hide
    // it so the admin table doesn't show empty built-in columns alongside
    // the sheet's real (renamed/variant) brand columns.
    const BUILTIN_HEADER_ALIASES = {
      bridgestone: ['tyrepricebridgestone', 'tyre_price_bridgestone', 'bridgestone'],
      yokohama: ['tyrepriceyokohama', 'tyre_price_yokohama', 'yokohama', 'yokohoma', 'tyrepriceyokohoma'],
      apollo: ['tyrepriceapollo', 'tyre_price_apollo', 'apollo'],
      michelin: ['tyrepricemichellin', 'tyre_price_michellin', 'michelin', 'michellin'],
      dummy2: ['tyrepricedummy2', 'tyre_price_dummy2', 'dummy2'],
      dummy: ['tyrepricedummy', 'tyre_price_dummy', 'dummy'],
      amaron: ['batterypriceamaron', 'battery_price_amaron', 'amaron'],
      exide: ['batterypriceexide', 'battery_price_exide', 'exide'],
    };
    const normalizeHeader = (s) => String(s || '').toLowerCase().replace(/[\s_\-()+.]/g, '');
    const normalizedHeaderSet = new Set(headers.filter(Boolean).map(normalizeHeader));
    const missingBuiltinKeys = Object.entries(BUILTIN_HEADER_ALIASES)
      .filter(([, aliases]) => !aliases.some((a) => normalizedHeaderSet.has(a)))
      .map(([key]) => key);

    if (missingBuiltinKeys.length > 0) {
      const currentHidden = await getHiddenBuiltinColumnsFromS3();
      const hiddenSet = new Set(currentHidden);
      let hiddenChanged = false;
      for (const key of missingBuiltinKeys) {
        if (!hiddenSet.has(key)) {
          hiddenSet.add(key);
          hiddenChanged = true;
        }
      }
      if (hiddenChanged) {
        await saveHiddenBuiltinColumnsToS3([...hiddenSet]);
        emitEntitySync('vehicle_reference_column', 'updated', { hiddenBuiltins: [...hiddenSet] });
        console.log(`Auto-hid built-in columns with no data in this sheet: ${missingBuiltinKeys.join(', ')}`);
      }
    }

    const fieldNameToHeader = new Map(
      [...headerFieldMap.entries()].map(([header, fieldName]) => [fieldName, header])
    );

    const vehicleData = dataRows
      .map((row, idx) => {
        const item = {};
        headers.forEach((header, index) => {
          if (header) {
            item[header] = row[index];
          }
        });
        return item;
      })
      .filter((item, idx) => {
        const fuzzyMatch = (obj, keys) => {
          const objectKeys = Object.keys(obj);
          const foundKey = objectKeys.find(k => {
            const normalizedK = k.toLowerCase().replace(/[\s_\-()+.]/g, '');
            return keys.some(key => {
              const normalizedKey = key.toLowerCase().replace(/[\s_\-()+.]/g, '');
              return normalizedK === normalizedKey;
            });
          });
          return foundKey ? obj[foundKey] : undefined;
        };

        const brand = fuzzyMatch(item, ['brandname', 'brand_name', 'brand']);
        const model = fuzzyMatch(item, ['model']);
        const brandModel = fuzzyMatch(item, ['brandmodel', 'brand_model', 'brand_model_name', 'variant']);

        const isValid = brand && model && brandModel;
        if (!isValid && idx < 5) {
          console.log(`Row ${idx + headerRowIndex + 2} is invalid:`, { brand, model, brandModel, item });
        }
        return isValid;
      })
      .map((item) => {
        const fuzzyMatch = (obj, keys) => {
          const objectKeys = Object.keys(obj);
          const foundKey = objectKeys.find(k => {
            const normalizedK = k.toLowerCase().replace(/[\s_\-()+.]/g, '');
            return keys.some(key => {
              const normalizedKey = key.toLowerCase().replace(/[\s_\-()+.]/g, '');
              return normalizedK === normalizedKey;
            });
          });
          return foundKey ? obj[foundKey] : undefined;
        };

        return {
          brand_name: String(fuzzyMatch(item, ['brandname', 'brand_name', 'brand']) || '').trim(),
          model: String(fuzzyMatch(item, ['model']) || '').trim(),
          brand_model: String(fuzzyMatch(item, ['brandmodel', 'brand_model', 'brand_model_name', 'variant']) || '').trim(),
          front_tyres: String(fuzzyMatch(item, ['fronttyres', 'fronttyre', 'front_tyres', 'front_tyre', 'front_tyre_size']) || '').trim(),
          rear_tyres: String(fuzzyMatch(item, ['reartyres', 'reartyre', 'rear_tyres', 'rear_tyre', 'rear_tyre_size']) || '').trim(),
          battery_details: String(fuzzyMatch(item, ['batterydetails', 'battery', 'battery_info']) || '').trim(),
          pickup_drop_price: fuzzyMatch(item, ['pickup_drop_price', 'pickupprice', 'drop_price', 'pickupdrop_price', 'pickup_drop_price']) || '',
          tyre_price_bridgestone: fuzzyMatch(item, ['tyrepricebridgestone', 'tyre_price_bridgestone', 'bridgestone']) || '',
          tyre_price_yokohama: fuzzyMatch(item, ['tyrepriceyokohama', 'tyre_price_yokohama', 'yokohama', 'yokohoma', 'tyrepriceyokohoma']) || '',
          tyre_price_apollo: fuzzyMatch(item, ['tyrepriceapollo', 'tyre_price_apollo', 'apollo']) || '',
          tyre_price_michelin: fuzzyMatch(item, ['tyrepricemichellin', 'tyre_price_michellin', 'michelin', 'michellin']) || '',
          tyre_price_dummy2: fuzzyMatch(item, ['tyrepricedummy2', 'tyre_price_dummy2', 'dummy2']) || '',
          tyre_price_dummy: fuzzyMatch(item, ['tyrepricedummy', 'tyre_price_dummy', 'dummy']) || '',
          battery_price_amaron: fuzzyMatch(item, ['batterypriceamaron', 'battery_price_amaron', 'amaron']) || '',
          battery_price_exide: fuzzyMatch(item, ['batterypriceexide', 'battery_price_exide', 'exide']) || '',
          car_wash_price: fuzzyMatch(item, ['carwashprice', 'car_wash_price', 'carwash']) || '',
          car_wash_exterior_price: fuzzyMatch(item, ['car_wash_exterior_wash', 'exterior_wash', 'car_wash_exterior_price', 'carwash-exteriorwash', 'washext', 'wash(ext)']) || '',
          car_wash_interior_exterior_price: fuzzyMatch(item, ['car_wash_interior_exterior', 'interior_exterior', 'car_wash_interior_exterior_price', 'carwash-interior+exterior', 'washintext', 'wash(int+ext)']) || '',
          car_wash_interior_exterior_underbody_price: fuzzyMatch(item, ['car_wash_interior_exterior_underbody_wash', 'underbody_wash', 'car_wash_interior_exterior_underbody_price', 'carwash-interior+exterior+underbodywash', 'washfull', 'wash(full)']) || '',
          general_service_price: fuzzyMatch(item, [
            'generalprice',
            'general_price',
            'general service price',
            'generalserviceprice',
            'generalsvc',
          ]) || '',
          fuel_type: normalizeFuelType(fuzzyMatch(item, ['fueltype', 'fuel_type', 'fuel'])),
          ...Object.fromEntries(
            allDynamicColumns.map((col) => {
              const originalHeader = fieldNameToHeader.get(col.fieldName);
              const raw = originalHeader !== undefined
                ? item[originalHeader]
                : fuzzyMatch(item, [col.fieldName, col.label]);
              return [col.fieldName, raw ?? ''];
            })
          ),
        };
      });

    console.log('Processed valid vehicle rows:', vehicleData.length);

    if (vehicleData.length === 0) {
      return res.status(400).json({ 
        message: 'No valid vehicle data found. Ensure headers like "brand_name", "Model", and "brand_model" exist.' 
      });
    }

    // Load existing data from S3
    const existingData = await getVehicleDataFromS3();
    
    // Create a unique key for each vehicle: brand_name | model | brand_model |
    // fuel_type — the same variant name can exist once per fuel type (e.g.
    // a "Luxury Edition" offered in both Petrol and Diesel).
    const getUniqueKey = (item) => `${item.brand_name.toLowerCase()}|${item.model.toLowerCase()}|${item.brand_model.toLowerCase()}|${(item.fuel_type || '').toLowerCase()}`;
    
    const dataMap = new Map(existingData.map(item => [getUniqueKey(item), item]));

    let upsertedCount = 0;
    let modifiedCount = 0;

    vehicleData.forEach(item => {
      const key = getUniqueKey(item);
      if (dataMap.has(key)) {
        const existing = dataMap.get(key);
        dataMap.set(key, { ...existing, ...item, updatedAt: new Date().toISOString() });
        modifiedCount++;
      } else {
        const newItem = {
          _id: crypto.randomUUID(),
          ...item,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        dataMap.set(key, newItem);
        upsertedCount++;
      }
    });

    const updatedData = Array.from(dataMap.values());
    await saveVehicleDataToS3(updatedData);

    emitEntitySync('vehicle_reference', 'updated', updatedData);

    res.status(200).json({
      message: 'Data imported successfully and saved to S3',
      count: vehicleData.length,
      upsertedCount,
      modifiedCount,
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ 
      message: 'Failed to import data', 
      error: error.message 
    });
  }
}));

// @desc    List admin-defined dynamic price columns (extra brands)
// @route   GET /api/vehicle-reference/columns
// @access  Public/Private
router.get('/columns', asyncHandler(async (req, res) => {
  const columns = await getVehicleReferenceColumnsFromS3();
  res.json(columns);
}));

// @desc    Add a new dynamic price column (e.g. a new tyre/battery brand)
// @route   POST /api/vehicle-reference/columns
// @access  Private/Admin
router.post('/columns', protect, admin, asyncHandler(async (req, res) => {
  const { label, category } = req.body;

  const cleanLabel = String(label || '').trim();
  const cleanCategory = ['tyre', 'battery'].includes(category) ? category : null;

  if (!cleanLabel || cleanLabel.length > 40) {
    return res.status(400).json({ message: 'Column name is required (max 40 characters)' });
  }
  if (!cleanCategory) {
    return res.status(400).json({ message: 'Category must be one of: tyre, battery' });
  }

  const key = slugifyBrandKey(cleanLabel);
  if (!key || !/^[a-z0-9]+$/.test(key)) {
    return res.status(400).json({ message: 'Column name must contain letters or numbers' });
  }
  if (RESERVED_PRICE_KEYS.has(key)) {
    return res.status(400).json({ message: 'This brand already exists as a built-in column' });
  }

  const columns = await getVehicleReferenceColumnsFromS3();
  const duplicate = columns.find((c) => c.category === cleanCategory && c.key === key);
  if (duplicate) {
    return res.status(400).json({ message: 'A column with this name already exists' });
  }

  const newColumn = {
    key,
    label: cleanLabel,
    category: cleanCategory,
    fieldName: fieldNameForColumn(cleanCategory, key),
    createdAt: new Date().toISOString(),
  };

  const updatedColumns = [...columns, newColumn];
  await saveVehicleReferenceColumnsToS3(updatedColumns);
  emitEntitySync('vehicle_reference_column', 'created', newColumn);

  res.status(201).json(newColumn);
}));

// @desc    Rename a dynamic price column's display label (key/fieldName —
//          and therefore existing price data — are untouched).
// @route   PUT /api/vehicle-reference/columns/:category/:key
// @access  Private/Admin
router.put('/columns/:category/:key', protect, admin, asyncHandler(async (req, res) => {
  const { category, key } = req.params;
  const { label } = req.body;

  const cleanLabel = String(label || '').trim();
  if (!cleanLabel || cleanLabel.length > 40) {
    return res.status(400).json({ message: 'Column name is required (max 40 characters)' });
  }

  const columns = await getVehicleReferenceColumnsFromS3();
  const index = columns.findIndex((c) => c.category === category && c.key === key);
  if (index === -1) {
    return res.status(404).json({ message: 'Column not found' });
  }

  const updatedColumn = { ...columns[index], label: cleanLabel };
  const updatedColumns = [...columns];
  updatedColumns[index] = updatedColumn;

  await saveVehicleReferenceColumnsToS3(updatedColumns);
  emitEntitySync('vehicle_reference_column', 'updated', updatedColumn);

  res.json(updatedColumn);
}));

// @desc    Remove a dynamic price column definition
// @route   DELETE /api/vehicle-reference/columns/:category/:key
// @access  Private/Admin
router.delete('/columns/:category/:key', protect, admin, asyncHandler(async (req, res) => {
  const { category, key } = req.params;
  const columns = await getVehicleReferenceColumnsFromS3();
  const updatedColumns = columns.filter((c) => !(c.category === category && c.key === key));

  if (updatedColumns.length === columns.length) {
    return res.status(404).json({ message: 'Column not found' });
  }

  await saveVehicleReferenceColumnsToS3(updatedColumns);
  emitEntitySync('vehicle_reference_column', 'deleted', { category, key });

  res.json({ message: 'Column removed' });
}));

// @desc    List the 8 built-in brand columns with their hidden state and
//          any admin-renamed label.
// @route   GET /api/vehicle-reference/builtin-columns
// @access  Public/Private
router.get('/builtin-columns', asyncHandler(async (req, res) => {
  const [hidden, labels] = await Promise.all([
    getHiddenBuiltinColumnsFromS3(),
    getBuiltinColumnLabelsFromS3(),
  ]);
  const hiddenSet = new Set(hidden);
  res.json(BUILTIN_COLUMNS.map((col) => ({
    ...col,
    label: labels?.[col.key] || col.label,
    hidden: hiddenSet.has(col.key),
  })));
}));

// @desc    Hide/restore and/or rename a built-in brand column. Purely a
//          display/selection-list concern — underlying price data on
//          existing vehicle records is never touched, moved, or deleted
//          (the key/fieldName the data is stored under never changes).
// @route   PUT /api/vehicle-reference/builtin-columns/:key
// @access  Private/Admin
router.put('/builtin-columns/:key', protect, admin, asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { hidden, label } = req.body;

  const column = BUILTIN_COLUMNS.find((c) => c.key === key);
  if (!column) {
    return res.status(404).json({ message: 'Unknown built-in column' });
  }
  if (hidden === undefined && label === undefined) {
    return res.status(400).json({ message: 'Provide "hidden" and/or "label" to update' });
  }
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    return res.status(400).json({ message: '"hidden" must be true or false' });
  }

  let resolvedHidden;
  if (hidden !== undefined) {
    const current = await getHiddenBuiltinColumnsFromS3();
    const currentSet = new Set(current);
    if (hidden) {
      currentSet.add(key);
    } else {
      currentSet.delete(key);
    }
    await saveHiddenBuiltinColumnsToS3([...currentSet]);
    resolvedHidden = hidden;
  } else {
    resolvedHidden = (await getHiddenBuiltinColumnsFromS3()).includes(key);
  }

  let resolvedLabel = column.label;
  if (label !== undefined) {
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel || cleanLabel.length > 40) {
      return res.status(400).json({ message: 'Column name is required (max 40 characters)' });
    }
    const labels = await getBuiltinColumnLabelsFromS3();
    const updatedLabels = { ...labels, [key]: cleanLabel };
    await saveBuiltinColumnLabelsToS3(updatedLabels);
    resolvedLabel = cleanLabel;
  }

  emitEntitySync('vehicle_reference_column', 'updated', { key, hidden: resolvedHidden, label: resolvedLabel });

  res.json({ ...column, label: resolvedLabel, hidden: resolvedHidden });
}));

// @desc    Get all vehicle reference data
// @route   GET /api/vehicle-reference
// @access  Public/Private
router.get('/', asyncHandler(async (req, res) => {
  const data = await getVehicleDataFromS3();
  // Sort by brand_name and model
  data.sort((a, b) => {
    if (a.brand_name < b.brand_name) return -1;
    if (a.brand_name > b.brand_name) return 1;
    if (a.model < b.model) return -1;
    if (a.model > b.model) return 1;
    return 0;
  });
  res.json(data);
}));

// @desc    Get tire details by brand and model
// @route   GET /api/vehicle-reference/search
// @access  Public/Private
router.get('/search', asyncHandler(async (req, res) => {
  const { brand_name, model, variant, fuel_type, year } = req.query;

  if (!brand_name || !model) {
    return res.status(400).json({ message: 'Brand and Model are required' });
  }

  // Catalogue rows (with year ranges): PDF lookup rules, and prices a booking
  // can't be charged at come back as "Contact Carzzi" (see pricedView).
  const catalog = await getVehicleDataFromS3();
  if (catalog.some((r) => r.year_range !== undefined)) {
    const m = findCatalogMatch(catalog, { brand: brand_name, model, variant, fuel: fuel_type, year });
    if (!m.row) return res.status(404).json({ message: 'Vehicle data not found' });
    return res.json({
      ...pricedView(m.row, m.confident),
      _match: { confident: m.confident, yearMatched: m.yearMatched, variantMatched: m.variantMatched },
    });
  }

  const cleanBrand = brand_name.trim().toLowerCase();
  const fullModel = model.trim().toLowerCase();
  const cleanModel = model.replace(/\[.*\]/g, '').trim().toLowerCase();
  const cleanVariant = variant ? variant.trim().toLowerCase() : '';
  const cleanFuelType = fuel_type ? fuel_type.trim().toLowerCase() : '';

  const allData = await getVehicleDataFromS3();

  // Helper function for regex-like match
  const matches = (value, search) => {
    if (!value) return false;
    return value.toLowerCase().includes(search);
  };

  const exactMatches = (value, search) => {
    if (!value) return false;
    return value.toLowerCase() === search;
  };

  const fuelTypeMatches = (item) => (item.fuel_type || '').toLowerCase() === cleanFuelType;

  // Same brand/model/variant can now have separate rows per fuel type (e.g.
  // Petrol vs Diesel pricing). When the caller knows the vehicle's fuel
  // type, prefer a row that matches it; otherwise fall back to the old
  // fuel-type-agnostic behavior (first match) so vehicles added before
  // fuel type existed, or with no fuel-type-specific row, still resolve.
  const findWithFuelTypePreference = (matchFn) => {
    if (cleanFuelType) {
      const fuelMatch = allData.find((item) => matchFn(item) && fuelTypeMatches(item));
      if (fuelMatch) return fuelMatch;
    }
    return allData.find(matchFn);
  };

  // 1. Try exact match for Brand, Model (full), and Variant
  if (cleanVariant) {
    const exactMatch = findWithFuelTypePreference((item) =>
      exactMatches(item.brand_name, cleanBrand) &&
      (exactMatches(item.model, fullModel) || exactMatches(item.model, cleanModel)) &&
      exactMatches(item.brand_model, cleanVariant)
    );
    if (exactMatch) {
      return res.json(exactMatch);
    }

    // 2. Strict exact match for Variant only (if user provided it, we want exact)
    // We removed the partial matches(item.brand_model, cleanVariant) as per user request
  }

  // 3. If no variant provided or no exact match, try exact model fallback
  const exactModelFallback = findWithFuelTypePreference((item) =>
    exactMatches(item.brand_name, cleanBrand) &&
    (exactMatches(item.model, fullModel) || exactMatches(item.model, cleanModel))
  );
  if (exactModelFallback) {
    return res.json(exactModelFallback);
  }

  // 4. Broader search: exact brand and partial model (only if no exact match was found)
  const fallbackData = findWithFuelTypePreference((item) =>
    exactMatches(item.brand_name, cleanBrand) &&
    (matches(item.model, fullModel) || matches(item.model, cleanModel))
  );

  if (fallbackData) {
    res.json(fallbackData);
  } else {
    res.status(404).json({ message: 'Vehicle data not found' });
  }
}));

// @desc    Create a vehicle reference
// @route   POST /api/vehicle-reference
// @access  Private/Admin
router.post('/', protect, admin, asyncHandler(async (req, res) => {
  const {
    brand_name, model, brand_model, front_tyres, rear_tyres, battery_details, pickup_drop_price,
    tyre_price_bridgestone, tyre_price_yokohama, tyre_price_apollo, tyre_price_michelin,
    tyre_price_dummy2, tyre_price_dummy, battery_price_amaron, battery_price_exide, car_wash_price,
    car_wash_exterior_price, car_wash_interior_exterior_price, car_wash_interior_exterior_underbody_price,
    general_service_price, fuel_type, year_range, body_type, tyre_size
  } = req.body;
  const fuel = fuel_type ? normalizeFuel(fuel_type) : '';

  if (!brand_name || !model || !brand_model) {
    return res.status(400).json({ message: 'Brand, Model, and Brand Model (Variant) are required' });
  }
  if (fuel_type && !fuel) {
    return res.status(400).json({ message: `Fuel type must be one of: ${FUEL_TYPES.join(', ')}` });
  }
  const yr = parseYearRange(year_range);
  if (year_range && yr.from === null) {
    return res.status(400).json({ message: 'Year Range must look like 2016–2020 or 2021 onwards' });
  }

  const allData = await getVehicleDataFromS3();
  // Same variant name is allowed more than once as long as the fuel type
  // differs (e.g. a "Luxury Edition" offered in both Petrol and Diesel) —
  // only an exact brand + model + variant + fuel type match is a duplicate.
  const normalizedFuelType = fuel.toLowerCase();
  const exists = allData.find(item =>
    item.brand_name.toLowerCase() === brand_name.toLowerCase() &&
    item.model.toLowerCase() === model.toLowerCase() &&
    item.brand_model.toLowerCase() === brand_model.toLowerCase() &&
    (item.fuel_type || '').toLowerCase() === normalizedFuelType &&
    String(item.year_range || '').trim() === String(year_range || '').trim()
  );

  if (exists) {
    return res.status(400).json({ message: 'Vehicle reference with this brand, model, variant, year range and fuel type already exists' });
  }

  const knownKeys = new Set([
    'brand_name', 'model', 'brand_model', 'front_tyres', 'rear_tyres', 'battery_details',
    'pickup_drop_price', 'tyre_price_bridgestone', 'tyre_price_yokohama', 'tyre_price_apollo',
    'tyre_price_michelin', 'tyre_price_dummy2', 'tyre_price_dummy', 'battery_price_amaron',
    'battery_price_exide', 'car_wash_price', 'car_wash_exterior_price',
    'car_wash_interior_exterior_price', 'car_wash_interior_exterior_underbody_price',
    'general_service_price', 'fuel_type', 'year_range', 'year_from', 'year_to', 'body_type', 'tyre_size',
  ]);
  // Any additional admin-defined brand columns (e.g. tyre_price_continental)
  // ride along in the request body and get merged in as-is.
  const dynamicFields = extractDynamicFields(req.body, knownKeys);

  const newVehicle = {
    _id: crypto.randomUUID(),
    brand_name,
    model,
    brand_model,
    front_tyres,
    rear_tyres,
    battery_details,
    pickup_drop_price,
    tyre_price_bridgestone,
    tyre_price_yokohama,
    tyre_price_apollo,
    tyre_price_michelin,
    tyre_price_dummy2,
    tyre_price_dummy,
    battery_price_amaron,
    battery_price_exide,
    car_wash_price,
    car_wash_exterior_price,
    car_wash_interior_exterior_price,
    car_wash_interior_exterior_underbody_price,
    general_service_price,
    fuel_type: fuel,
    year_range: String(year_range || '').trim(),
    year_from: yr.from,
    year_to: yr.to,
    body_type: normalizeBody(body_type),
    tyre_size: String(tyre_size || '').trim(),
    ...(tyre_size ? { front_tyres: parseTyreSize(tyre_size).front, rear_tyres: parseTyreSize(tyre_size).rear } : {}),
    ...dynamicFields,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  allData.push(newVehicle);
  await saveVehicleDataToS3(allData);
  emitEntitySync('vehicle_reference', 'created', newVehicle);

  res.status(201).json(newVehicle);
}));

// @desc    Update a vehicle reference
// @route   PUT /api/vehicle-reference/:id
// @access  Private/Admin
router.put('/:id', protect, admin, asyncHandler(async (req, res) => {
  const allData = await getVehicleDataFromS3();
  const index = allData.findIndex(item => item._id === req.params.id);

  if (index !== -1) {
    if (req.body.fuel_type) req.body.fuel_type = normalizeFuel(req.body.fuel_type) || req.body.fuel_type;
    if (req.body.fuel_type && !FUEL_TYPES.includes(req.body.fuel_type)) {
      return res.status(400).json({ message: `Fuel type must be one of: ${FUEL_TYPES.join(', ')}` });
    }

    const updateKnownKeys = new Set([
      'brand_name', 'model', 'brand_model', 'front_tyres', 'rear_tyres', 'battery_details',
      'pickup_drop_price', 'tyre_price_bridgestone', 'tyre_price_yokohama', 'tyre_price_apollo',
      'tyre_price_michelin', 'tyre_price_dummy2', 'tyre_price_dummy', 'battery_price_amaron',
      'battery_price_exide', 'car_wash_price', 'car_wash_exterior_price',
      'car_wash_interior_exterior_price', 'car_wash_interior_exterior_underbody_price',
      'general_service_price', 'fuel_type', 'year_range', 'year_from', 'year_to', 'body_type', 'tyre_size',
    ]);
    const dynamicFields = extractDynamicFields(req.body, updateKnownKeys);
    const catalogFields = {};
    if (req.body.year_range !== undefined) {
      const yr = parseYearRange(req.body.year_range);
      if (String(req.body.year_range).trim() && yr.from === null) {
        return res.status(400).json({ message: 'Year Range must look like 2016–2020 or 2021 onwards' });
      }
      Object.assign(catalogFields, { year_range: String(req.body.year_range).trim(), year_from: yr.from, year_to: yr.to });
    }
    if (req.body.body_type !== undefined) catalogFields.body_type = normalizeBody(req.body.body_type);
    if (req.body.tyre_size !== undefined) {
      const ts = parseTyreSize(req.body.tyre_size);
      Object.assign(catalogFields, { tyre_size: String(req.body.tyre_size).trim(), front_tyres: ts.front, rear_tyres: ts.rear });
    }

    const updatedVehicle = {
      ...allData[index],
      brand_name: req.body.brand_name || allData[index].brand_name,
      model: req.body.model || allData[index].model,
      brand_model: req.body.brand_model || allData[index].brand_model,
      front_tyres: req.body.front_tyres || allData[index].front_tyres,
      rear_tyres: req.body.rear_tyres || allData[index].rear_tyres,
      battery_details: req.body.battery_details || allData[index].battery_details,
      pickup_drop_price: req.body.pickup_drop_price !== undefined ? req.body.pickup_drop_price : allData[index].pickup_drop_price,
      tyre_price_bridgestone: req.body.tyre_price_bridgestone !== undefined ? req.body.tyre_price_bridgestone : allData[index].tyre_price_bridgestone,
      tyre_price_yokohama: req.body.tyre_price_yokohama !== undefined ? req.body.tyre_price_yokohama : allData[index].tyre_price_yokohama,
      tyre_price_apollo: req.body.tyre_price_apollo !== undefined ? req.body.tyre_price_apollo : allData[index].tyre_price_apollo,
      tyre_price_michelin: req.body.tyre_price_michelin !== undefined ? req.body.tyre_price_michelin : allData[index].tyre_price_michelin,
      tyre_price_dummy2: req.body.tyre_price_dummy2 !== undefined ? req.body.tyre_price_dummy2 : allData[index].tyre_price_dummy2,
      tyre_price_dummy: req.body.tyre_price_dummy !== undefined ? req.body.tyre_price_dummy : allData[index].tyre_price_dummy,
      battery_price_amaron: req.body.battery_price_amaron !== undefined ? req.body.battery_price_amaron : allData[index].battery_price_amaron,
      battery_price_exide: req.body.battery_price_exide !== undefined ? req.body.battery_price_exide : allData[index].battery_price_exide,
      car_wash_price: req.body.car_wash_price !== undefined ? req.body.car_wash_price : allData[index].car_wash_price,
      car_wash_exterior_price: req.body.car_wash_exterior_price !== undefined ? req.body.car_wash_exterior_price : allData[index].car_wash_exterior_price,
      car_wash_interior_exterior_price: req.body.car_wash_interior_exterior_price !== undefined ? req.body.car_wash_interior_exterior_price : allData[index].car_wash_interior_exterior_price,
      car_wash_interior_exterior_underbody_price: req.body.car_wash_interior_exterior_underbody_price !== undefined ? req.body.car_wash_interior_exterior_underbody_price : allData[index].car_wash_interior_exterior_underbody_price,
      general_service_price: req.body.general_service_price !== undefined ? req.body.general_service_price : allData[index].general_service_price,
      fuel_type: req.body.fuel_type !== undefined ? req.body.fuel_type : allData[index].fuel_type,
      ...dynamicFields,
      ...catalogFields,
      updatedAt: new Date().toISOString()
    };

    allData[index] = updatedVehicle;
    await saveVehicleDataToS3(allData);
    emitEntitySync('vehicle_reference', 'updated', updatedVehicle);
    res.json(updatedVehicle);
  } else {
    res.status(404).json({ message: 'Vehicle reference not found' });
  }
}));

// @desc    Delete all vehicle references
// @route   DELETE /api/vehicle-reference/all
// @access  Private/Admin
router.delete('/all', protect, admin, asyncHandler(async (req, res) => {
  await saveVehicleDataToS3([]);
  emitEntitySync('vehicle_reference', 'deleted', {all: true});
  res.json({ message: 'All vehicle references removed' });
}));

// @desc    Delete a vehicle reference
// @route   DELETE /api/vehicle-reference/:id
// @access  Private/Admin
router.delete('/:id', protect, admin, asyncHandler(async (req, res) => {
  const allData = await getVehicleDataFromS3();
  const filteredData = allData.filter(item => item._id !== req.params.id);

  if (filteredData.length < allData.length) {
    await saveVehicleDataToS3(filteredData);
    emitEntitySync('vehicle_reference', 'deleted', {_id: req.params.id});
    res.json({ message: 'Vehicle reference removed' });
  } else {
    res.status(404).json({ message: 'Vehicle reference not found' });
  }
}));

export default router;
