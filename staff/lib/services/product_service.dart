import '../../core/api_client.dart';
import '../../core/env.dart';

class Product {
  final String id;
  final String name;
  final String category;
  final double price;
  final int quantity;
  final int threshold;

  Product({
    required this.id,
    required this.name,
    required this.category,
    required this.price,
    required this.quantity,
    required this.threshold,
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['_id'] ?? '',
      name: json['name'] ?? '',
      category: json['category'] ?? '',
      price: (json['price'] ?? 0).toDouble(),
      quantity: json['quantity'] ?? 0,
      threshold: json['threshold'] ?? 0,
    );
  }
}

class ProductService {
  final ApiClient _api = ApiClient();

  Future<List<Product>> getProducts() async {
    final response = await _api.getAny(ApiEndpoints.products);
    if (response is List) {
      return response.map((json) => Product.fromJson(json)).toList();
    }
    return [];
  }

  Future<Product> updateProduct(String id, Map<String, dynamic> data) async {
    final response = await _api.putJson(
      '${ApiEndpoints.products}/$id',
      body: data,
    );
    return Product.fromJson(response);
  }

  Future<Product> createProduct(Map<String, dynamic> data) async {
    final response = await _api.postJson(ApiEndpoints.products, body: data);
    return Product.fromJson(response);
  }
}
