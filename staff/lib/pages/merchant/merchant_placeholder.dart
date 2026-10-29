import 'package:flutter/material.dart';
import '../../widgets/merchant/merchant_nav.dart';

class MerchantPlaceholderPage extends StatelessWidget {
  final String title;

  const MerchantPlaceholderPage({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return MerchantScaffold(
      title: title,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.construction, size: 64, color: Colors.grey[400]),
            const SizedBox(height: 16),
            Text(
              '$title coming soon',
              style: TextStyle(
                fontSize: 18,
                color: Colors.grey[600],
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
