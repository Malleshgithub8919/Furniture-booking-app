import 'package:flutter_test/flutter_test.dart';
import 'package:vendor_app/main.dart';

void main() {
  testWidgets('VendorApp renders without crashing', (WidgetTester tester) async {
    await tester.pumpWidget(const VendorApp());
    expect(find.text('Vendor Hub'), findsOneWidget);
  });
}
