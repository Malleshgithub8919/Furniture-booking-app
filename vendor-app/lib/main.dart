import 'package:flutter/material.dart';
void main() => runApp(const VendorApp());
class VendorApp extends StatelessWidget {
  const VendorApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(debugShowCheckedModeBanner: false, title: 'Vendor Hub', theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF315C4B)), useMaterial3: true), home: const VendorHome());
}
class VendorHome extends StatelessWidget {
  const VendorHome({super.key});
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Vendor Hub')), body: ListView(padding: const EdgeInsets.all(20), children: [
    Text('Your business,\nin one place.', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold)),
    const SizedBox(height: 20),
    const _MetricCard(title: 'New orders', value: '—', icon: Icons.shopping_bag_outlined),
    const _MetricCard(title: 'Products listed', value: '—', icon: Icons.chair_outlined),
    const _MetricCard(title: 'Earnings', value: '—', icon: Icons.currency_rupee),
    const SizedBox(height: 16),
    const Text('Vendor account and order data will load from the secured backend after authentication is implemented.')
  ]));
}
class _MetricCard extends StatelessWidget {
  final String title, value; final IconData icon;
  const _MetricCard({required this.title, required this.value, required this.icon});
  @override Widget build(BuildContext context) => Card(child: ListTile(leading: Icon(icon), title: Text(title), trailing: Text(value, style: const TextStyle(fontWeight: FontWeight.bold))));
}
