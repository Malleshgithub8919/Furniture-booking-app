import 'package:flutter/material.dart';

void main() => runApp(const DeliveryApp());

class DeliveryApp extends StatelessWidget {
  const DeliveryApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'Delivery Partner',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF315C4B)),
          useMaterial3: true,
        ),
        home: const DeliveryHome(),
      );
}

class DeliveryHome extends StatelessWidget {
  const DeliveryHome({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Delivery Partner')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'Deliver with\nconfidence.',
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 20),
            Card(
              child: ListTile(
                leading: const Icon(Icons.local_shipping_outlined),
                title: const Text('Assigned deliveries'),
                subtitle: const Text('No live jobs connected yet'),
                trailing: const Icon(Icons.chevron_right),
              ),
            ),
            // FIX: second Card was missing its closing ')' — SizedBox and Text
            // were orphaned outside the ListView children list in the original file.
            Card(
              child: ListTile(
                leading: const Icon(Icons.account_circle_outlined),
                title: const Text('Profile & availability'),
                subtitle: const Text(
                    'Approval and availability controls will be added'),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Delivery jobs will be visible only after secure login and '
              'server-side assignment checks are implemented.',
            ),
          ],
        ),
      );
}
