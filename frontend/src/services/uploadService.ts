import api from './api';

const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      resolve(file);
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          const MAX_WIDTH = 2048;
          const MAX_HEIGHT = 2048;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(file);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                });
                resolve(compressedFile);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            0.9
          );
        } catch (err) {
          console.error('Canvas compression error:', err);
          resolve(file);
        }
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};


/** e.g. "Carzzi_Invoice_INV2026102904.jpg" — keeps the uploaded file's extension. */
export const invoiceFileName = (fileUrl: string, orderNumber?: string | null) => {
  const ext = (fileUrl.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/)?.[1] || 'pdf').toLowerCase();
  return `Carzzi_Invoice_${orderNumber || 'booking'}.${ext}`;
};

export const uploadService = {
  uploadFile: async (file: File, options?: { skipCompression?: boolean }) => {
    let fileToUpload = file;

    // Compress if it's an image, unless the caller explicitly opted out
    // (e.g. hero section images, which must be stored at original quality).
    if (file.type.startsWith('image/') && !options?.skipCompression) {
      fileToUpload = await compressImage(file);
    }

    // 1. Get Presigned URL
    const response = await api.get('/upload/presigned-url', {
      params: { filename: fileToUpload.name, fileType: fileToUpload.type }
    });
    const { presignedUrl, fileUrl, filename, originalName } = response.data;

    // 2. Upload directly to S3
    await fetch(presignedUrl, {
      method: 'PUT',
      body: fileToUpload,
      headers: {
        'Content-Type': fileToUpload.type,
      },
    });

    return { url: fileUrl, filename, originalName, mimetype: fileToUpload.type, size: fileToUpload.size };
  },

  uploadPublicFile: async (file: File) => {
    let fileToUpload = file;
    if (file.type.startsWith('image/')) {
      fileToUpload = await compressImage(file);
    }

    const formData = new FormData();
    formData.append('file', fileToUpload);

    const response = await api.post('/upload/public', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  },

  uploadFiles: async (files: File[]) => {
    const uploadPromises = files.map(async (file) => {
      let fileToUpload = file;
      if (file.type.startsWith('image/')) {
        fileToUpload = await compressImage(file);
      }

      const response = await api.get('/upload/presigned-url', {
        params: { filename: fileToUpload.name, fileType: fileToUpload.type }
      });
      const { presignedUrl, fileUrl, filename, originalName } = response.data;

      await fetch(presignedUrl, {
        method: 'PUT',
        body: fileToUpload,
        headers: {
          'Content-Type': fileToUpload.type,
        },
      });

      return { url: fileUrl, filename, originalName, mimetype: fileToUpload.type, size: fileToUpload.size };
    });

    const uploadedFiles = await Promise.all(uploadPromises);
    return { files: uploadedFiles };
  },

  getResumeSignedUrl: async (url: string) => {
    const response = await api.get('/upload/resume/signed-url', {
      params: { url }
    });
    return response.data.url;
  },

  /**
   * Save an uploaded S3 file to the device instead of previewing it. S3 is
   * cross-origin, so `<a download>` is ignored — the backend signs a URL
   * with `Content-Disposition: attachment`, which forces a download.
   */
  downloadFile: async (fileUrl: string, filename?: string) => {
    const response = await api.get('/upload/download-url', {
      params: { url: fileUrl, filename }
    });
    const link = document.createElement('a');
    link.href = response.data.url;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
};
