process.env.NODE_ENV = 'test';

import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';
import VendorProfile from '../src/models/VendorProfile.js';
import Category from '../src/models/Category.js';
import Product from '../src/models/Product.js';
import Cart from '../src/models/Cart.js';
import Address from '../src/models/Address.js';
import ParentOrder from '../src/models/ParentOrder.js';
import VendorOrder from '../src/models/VendorOrder.js';
import Payment from '../src/models/Payment.js';
import DeliveryPartnerProfile from '../src/models/DeliveryPartnerProfile.js';
import DeliveryAssignment from '../src/models/DeliveryAssignment.js';
import { orderService } from '../src/services/order.service.js';
import { otpService } from '../src/services/otp.service.js';

let server;
let baseUrl;

const runId = Date.now().toString().slice(-6);

let customerUser, tokenCustomer;
let otherCustomer, tokenOtherCustomer;
let adminUser, tokenAdmin;
let deliveryUser1, tokenDelivery1;
let deliveryUser2, tokenDelivery2;
let vendorUser, vendorProfile;
let testCategory;
let testProduct;
let testAddress;

before(async () => {
  const testDbUri = env.mongoUri.includes('/furniture_marketplace?')
    ? env.mongoUri.replace('/furniture_marketplace?', '/furniture_marketplace_test?')
    : (env.mongoUri ? `${env.mongoUri}_test` : '');

  assert.ok(testDbUri.includes('furniture_marketplace_test'), 'Safety guard: Must use test database');

  await mongoose.connect(testDbUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 45000
  });

  await ParentOrder.init();
  await VendorOrder.init();
  await Payment.init();
  await DeliveryPartnerProfile.init();
  await DeliveryAssignment.init();
  await Product.init();
  await Cart.init();
  await Address.init();

  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  // 1. Seed Customer
  customerUser = await User.create({
    name: 'Customer Clara',
    email: `clara_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  tokenCustomer = jwt.sign({ sub: customerUser.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  otherCustomer = await User.create({
    name: 'Customer Oscar',
    email: `oscar_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'customer',
    status: 'active',
    emailVerified: true
  });
  tokenOtherCustomer = jwt.sign({ sub: otherCustomer.id, role: 'customer' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 2. Seed Admin
  adminUser = await User.create({
    name: 'Admin Dispatcher',
    email: `admin_dispatch_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'admin',
    status: 'active',
    emailVerified: true
  });
  tokenAdmin = jwt.sign({ sub: adminUser.id, role: 'admin' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 3. Seed Delivery Partners (User records with role: 'delivery')
  deliveryUser1 = await User.create({
    name: 'Rider Arjun',
    email: `arjun_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'delivery',
    status: 'active',
    emailVerified: true
  });
  tokenDelivery1 = jwt.sign({ sub: deliveryUser1.id, role: 'delivery' }, env.jwtAccessSecret, { expiresIn: '1h' });

  deliveryUser2 = await User.create({
    name: 'Rider Bhim',
    email: `bhim_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'delivery',
    status: 'active',
    emailVerified: true
  });
  tokenDelivery2 = jwt.sign({ sub: deliveryUser2.id, role: 'delivery' }, env.jwtAccessSecret, { expiresIn: '1h' });

  // 4. Seed Vendor & Profile
  vendorUser = await User.create({
    name: 'Royal Oak Crafts',
    email: `royaloak_${runId}@example.com`,
    passwordHash: 'dummy_hash',
    role: 'vendor',
    status: 'active',
    emailVerified: true
  });
  vendorProfile = await VendorProfile.create({
    userId: vendorUser._id,
    storeName: `Royal Oak Crafts-${runId}`,
    storeSlug: `royaloak-${runId}`,
    description: 'Bespoke wooden furniture crafts',
    businessPhone: '9876543210',
    address: {
      street: '44 Timber Yard',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560002'
    },
    status: 'approved',
    commissionRate: 10
  });

  // 5. Seed Category & Product
  testCategory = await Category.create({
    name: `Wardrobes ${runId}`,
    slug: `wardrobes-${runId}`
  });

  testProduct = await Product.create({
    vendorId: vendorProfile._id,
    categoryId: testCategory._id,
    name: 'Oak Two-Door Wardrobe',
    description: 'Spacious engineered oak wood wardrobe',
    slug: `oak-wardrobe-${runId}`,
    sku: `SKU-WDR-${runId}`,
    price: 3200000, // 32,000.00 in integer paise
    stock: 15,
    reservedStock: 0,
    status: 'approved',
    availableColors: ['Dark Walnut', 'Natural Oak']
  });

  // 6. Seed Address
  testAddress = await Address.create({
    userId: customerUser._id,
    fullName: 'Clara Oswald',
    phone: '9876543210',
    street: '221B Baker Street Extension',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    isDefault: true
  });
});

after(async () => {
  const userIds = [customerUser?._id, otherCustomer?._id, adminUser?._id, deliveryUser1?._id, deliveryUser2?._id, vendorUser?._id].filter(Boolean);
  if (userIds.length > 0) {
    await User.deleteMany({ _id: { $in: userIds } });
    await DeliveryPartnerProfile.deleteMany({ userId: { $in: userIds } });
    await DeliveryAssignment.deleteMany({ customerId: { $in: userIds } });
    await Cart.deleteMany({ userId: { $in: userIds } });
    await ParentOrder.deleteMany({ userId: { $in: userIds } });
    await VendorOrder.deleteMany({ customerId: { $in: userIds } });
    await Payment.deleteMany({ userId: { $in: userIds } });
    await Address.deleteMany({ userId: { $in: userIds } });
  }
  if (vendorProfile?._id) await VendorProfile.deleteOne({ _id: vendorProfile._id });
  if (testCategory?._id) await Category.deleteOne({ _id: testCategory._id });
  if (testProduct?._id) await Product.deleteOne({ _id: testProduct._id });

  if (server) server.close();
  await mongoose.disconnect();
});

describe('Phase 7: Delivery App APIs & Assignment Architecture', { concurrency: 1 }, () => {
  let partnerProfile1;
  let partnerProfile2;
  let testVendorOrder;
  let createdAssignment;
  let plainPickupOtp;
  let plainDeliveryOtp;

  // Helper to place an order
  async function placeOrder(paymentMethod = 'cod') {
    await Cart.findOneAndUpdate(
      { userId: customerUser._id },
      {
        userId: customerUser._id,
        items: [{ productId: testProduct._id, quantity: 1, selectedColor: 'Natural Oak' }]
      },
      { upsert: true, new: true }
    );

    const { order, vendorOrders } = await orderService.checkout({
      userId: customerUser._id,
      addressId: testAddress._id,
      paymentMethod,
      idempotencyKey: `IDEM-DELIV-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
    });
    return { order, vendorOrder: vendorOrders[0] };
  }

  test('1. Delivery partner profile onboarding & duplicate prevention', async () => {
    // Customer cannot onboard as delivery partner (HTTP 403)
    const custRes = await fetch(`${baseUrl}/api/delivery/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCustomer}`
      },
      body: JSON.stringify({
        phone: '9876543210',
        vehicleType: 'mini_truck',
        vehicleNumber: 'KA-01-EQ-9999',
        licenseNumber: 'DL-2026-0001',
        identityProof: { type: 'aadhaar', documentNumber: '123456789012' }
      })
    });
    assert.equal(custRes.status, 403, 'Customer cannot onboard as delivery partner');

    // Delivery user 1 onboards successfully
    const res1 = await fetch(`${baseUrl}/api/delivery/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({
        phone: '9876543210',
        vehicleType: 'mini_truck',
        vehicleNumber: 'KA-01-EQ-1111',
        licenseNumber: 'DL-2026-1111',
        identityProof: { type: 'driving_license', documentNumber: 'DL-998877' },
        servicePincodes: ['560001', '560002']
      })
    });
    assert.equal(res1.status, 201);
    const body1 = await res1.json();
    assert.equal(body1.success, true);
    assert.equal(body1.data.approvalStatus, 'pending');
    assert.equal(body1.data.availabilityStatus, 'offline');
    partnerProfile1 = body1.data;

    // Delivery user 2 onboards successfully
    const res2 = await fetch(`${baseUrl}/api/delivery/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery2}`
      },
      body: JSON.stringify({
        phone: '9876543211',
        vehicleType: 'van',
        vehicleNumber: 'KA-01-EQ-2222',
        licenseNumber: 'DL-2026-2222',
        identityProof: { type: 'pan', documentNumber: 'ABCDE1234F' }
      })
    });
    assert.equal(res2.status, 201);
    const body2 = await res2.json();
    partnerProfile2 = body2.data;

    // Duplicate onboarding rejected with HTTP 409
    const dupRes = await fetch(`${baseUrl}/api/delivery/onboard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({
        phone: '9876543210',
        vehicleType: 'mini_truck',
        vehicleNumber: 'KA-01-EQ-1111',
        licenseNumber: 'DL-2026-1111',
        identityProof: { type: 'driving_license', documentNumber: 'DL-998877' }
      })
    });
    assert.equal(dupRes.status, 409, 'Duplicate onboarding rejected with 409 Conflict');
  });

  test('2. Admin approves delivery partner and partner toggles availability', async () => {
    // Unapproved partner cannot toggle availability to available (HTTP 403)
    const toggleFail = await fetch(`${baseUrl}/api/delivery/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ availabilityStatus: 'available' })
    });
    assert.equal(toggleFail.status, 403);

    // Admin approves Partner 1 and Partner 2
    const approveRes1 = await fetch(`${baseUrl}/api/delivery/admin/partners/${partnerProfile1._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(approveRes1.status, 200);
    const approvedPartner = await approveRes1.json();
    assert.equal(approvedPartner.data.identityProof, undefined);

    const approveRes2 = await fetch(`${baseUrl}/api/delivery/admin/partners/${partnerProfile2._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({ status: 'approved' })
    });
    assert.equal(approveRes2.status, 200);

    // Partner 1 toggles availability to available
    const toggleSuccess = await fetch(`${baseUrl}/api/delivery/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ availabilityStatus: 'available' })
    });
    assert.equal(toggleSuccess.status, 200);
    const toggleBody = await toggleSuccess.json();
    assert.equal(toggleBody.data.availabilityStatus, 'available');

    const adminOfflineRes = await fetch(`${baseUrl}/api/delivery/admin/partners/${partnerProfile1._id}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ availabilityStatus: 'offline' })
    });
    assert.equal(adminOfflineRes.status, 200);
    assert.equal((await adminOfflineRes.json()).data.availabilityStatus, 'offline');

    const adminAvailableRes = await fetch(`${baseUrl}/api/delivery/admin/partners/${partnerProfile1._id}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ availabilityStatus: 'available' })
    });
    assert.equal(adminAvailableRes.status, 200);
  });

  test('3. Admin assigns delivery to available partner; OTP generated & partner marked busy', async () => {
    const { vendorOrder } = await placeOrder('cod');
    testVendorOrder = vendorOrder;

    const assignRes = await fetch(`${baseUrl}/api/delivery/admin/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({
        vendorOrderId: testVendorOrder._id.toString(),
        deliveryPartnerId: partnerProfile1._id.toString()
      })
    });

    assert.equal(assignRes.status, 201);
    const body = await assignRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'assigned');
    assert.ok(body.data.assignmentNumber.startsWith('DEL-'), 'Assignment number generated');

    // Rule: Plain OTP values are NEVER in API response or default select query
    assert.equal(body.data.pickupOtp, undefined, 'Plain pickup OTP not exposed in response');
    assert.equal(body.data.deliveryOtp, undefined, 'Plain delivery OTP not exposed in response');
    assert.equal(body.data.pickupOtpHash, undefined, 'OTP hash not selected');
    assert.equal(body.data.deliveryOtpHash, undefined, 'OTP hash not selected');

    createdAssignment = body.data;

    const adminPartnersRes = await fetch(`${baseUrl}/api/delivery/admin/partners?search=Rider%20Arjun`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` }
    });
    assert.equal(adminPartnersRes.status, 200);
    const adminPartners = await adminPartnersRes.json();
    assert.equal(adminPartners.data.partners[0]._id, partnerProfile1._id.toString());
    assert.equal(adminPartners.data.partners[0].identityProof, undefined);

    const adminAssignmentsRes = await fetch(`${baseUrl}/api/delivery/admin/assignments?search=${encodeURIComponent(body.data.assignmentNumber)}`, {
      headers: { Authorization: `Bearer ${tokenAdmin}` }
    });
    assert.equal(adminAssignmentsRes.status, 200);
    const adminAssignments = await adminAssignmentsRes.json();
    assert.equal(adminAssignments.data.assignments[0]._id, createdAssignment._id);
    assert.equal(adminAssignments.data.assignments[0].pickupOtpHash, undefined);
    assert.equal(adminAssignments.data.assignments[0].deliveryOtpHash, undefined);

    const activeAvailabilityRes = await fetch(`${baseUrl}/api/delivery/admin/partners/${partnerProfile1._id}/availability`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ availabilityStatus: 'offline' })
    });
    assert.equal(activeAvailabilityRes.status, 409);

    // Check partner is now busy
    const partnerCheck = await DeliveryPartnerProfile.findById(partnerProfile1._id);
    assert.equal(partnerCheck.availabilityStatus, 'busy', 'Partner locked to busy');

    // Check vendor sub-order updated to ready_for_pickup
    const voCheck = await VendorOrder.findById(testVendorOrder._id);
    assert.equal(voCheck.status, 'ready_for_pickup');

    // Prevents duplicate active assignment for same sub-order (HTTP 409)
    const dupAssign = await fetch(`${baseUrl}/api/delivery/admin/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({
        vendorOrderId: testVendorOrder._id.toString(),
        deliveryPartnerId: partnerProfile1._id.toString()
      })
    });
    assert.equal(dupAssign.status, 409);
  });

  test('4. Delivery partner views assigned orders; Partner B CANNOT access Partner A assignments (RBAC)', async () => {
    // Partner 1 queries assignments
    const listRes = await fetch(`${baseUrl}/api/delivery/assignments/mine`, {
      headers: { Authorization: `Bearer ${tokenDelivery1}` }
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.data.assignments.length, 1);
    assert.equal(listBody.data.assignments[0]._id, createdAssignment._id);

    // Partner 2 CANNOT access Partner 1 assignment details (Rule 14: 403 Forbidden)
    const forbiddenRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}`, {
      headers: { Authorization: `Bearer ${tokenDelivery2}` }
    });
    assert.equal(forbiddenRes.status, 403, 'Partner 2 forbidden from Partner 1 assignment');
  });

  test('5. Partner advances status to arrived_at_vendor and verifies pickup with valid OTP', async () => {
    // Partner arrives at vendor
    const statusRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ status: 'arrived_at_vendor' })
    });
    assert.equal(statusRes.status, 200);

    // Retrieve hashed OTP from DB for test verification simulation
    const assignmentWithOtp = await DeliveryAssignment.findById(createdAssignment._id)
      .select('+pickupOtpHash +deliveryOtpHash');

    // Mock an OTP and manually verify invalid OTP fails
    const invalidOtpRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}/verify-pickup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ otp: '000000' })
    });
    assert.equal(invalidOtpRes.status, 400);

    // Set a known OTP for test assertion
    plainPickupOtp = '456789';
    await DeliveryAssignment.findByIdAndUpdate(createdAssignment._id, {
      pickupOtpHash: otpService.hashOtp(plainPickupOtp)
    });

    // Submit correct pickup OTP
    const validPickupRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}/verify-pickup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ otp: plainPickupOtp })
    });
    assert.equal(validPickupRes.status, 200);
    const pickupBody = await validPickupRes.json();
    assert.equal(pickupBody.success, true);
    assert.equal(pickupBody.data.status, 'picked_up');

    // VendorOrder must now be 'shipped' (in transit)
    const voCheck = await VendorOrder.findById(testVendorOrder._id);
    assert.equal(voCheck.status, 'shipped');
    assert.equal(voCheck.statusHistory.at(-1).role, 'delivery');
  });

  test('6. Partner marks out_for_delivery; Customer tracks delivery progress without OTP exposure', async () => {
    // Partner marks out_for_delivery
    const outRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ status: 'out_for_delivery' })
    });
    assert.equal(outRes.status, 200);

    // Customer tracks delivery
    const trackRes = await fetch(`${baseUrl}/api/delivery/track/order/${testVendorOrder.parentOrderId}`, {
      headers: { Authorization: `Bearer ${tokenCustomer}` }
    });
    assert.equal(trackRes.status, 200);
    const trackBody = await trackRes.json();
    assert.equal(trackBody.success, true);
    assert.equal(trackBody.data.deliveries[0].status, 'out_for_delivery');
    assert.equal(trackBody.data.deliveries[0].deliveryPartner.name, 'Rider Arjun');
    assert.equal(trackBody.data.deliveries[0].deliveryPartner.vehicleType, 'mini_truck');

    // Other customer cannot track this order (Rule 14: 404/Forbidden)
    const otherTrack = await fetch(`${baseUrl}/api/delivery/track/order/${testVendorOrder.parentOrderId}`, {
      headers: { Authorization: `Bearer ${tokenOtherCustomer}` }
    });
    assert.equal(otherTrack.status, 404);
  });

  test('7. Customer provides delivery OTP upon handover; marks delivered, captures COD, frees partner', async () => {
    // Set known delivery OTP for test assertion
    plainDeliveryOtp = '654321';
    await DeliveryAssignment.findByIdAndUpdate(createdAssignment._id, {
      deliveryOtpHash: otpService.hashOtp(plainDeliveryOtp)
    });

    // Submitting wrong OTP fails with 400
    const failRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}/verify-delivery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ otp: '111111' })
    });
    assert.equal(failRes.status, 400);

    // Submit valid delivery OTP
    const completeRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}/verify-delivery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ otp: plainDeliveryOtp })
    });

    assert.equal(completeRes.status, 200);
    const completeBody = await completeRes.json();
    assert.equal(completeBody.success, true);
    assert.equal(completeBody.data.status, 'delivered');
    assert.equal(completeBody.data.codCollected, true);

    // Verify DB states
    const finalAssignment = await DeliveryAssignment.findById(createdAssignment._id);
    assert.equal(finalAssignment.status, 'delivered');
    assert.equal(finalAssignment.codCollected, true);

    const finalSubOrder = await VendorOrder.findById(testVendorOrder._id);
    assert.equal(finalSubOrder.status, 'delivered');
    assert.equal(finalSubOrder.statusHistory.at(-1).role, 'delivery');

    const finalParent = await ParentOrder.findById(testVendorOrder.parentOrderId);
    assert.equal(finalParent.orderStatus, 'completed');
    assert.equal(finalParent.paymentStatus, 'captured');

    // Partner availability automatically released to 'available' and successful metrics incremented
    const partner = await DeliveryPartnerProfile.findById(partnerProfile1._id);
    assert.equal(partner.availabilityStatus, 'available');
    assert.equal(partner.metrics.successfulDeliveries, 1);
  });

  test('8. Duplicate delivery completion is strictly prevented (HTTP 400)', async () => {
    const dupRes = await fetch(`${baseUrl}/api/delivery/assignments/${createdAssignment._id}/verify-delivery`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ otp: plainDeliveryOtp })
    });

    assert.equal(dupRes.status, 400);
    const body = await dupRes.json();
    assert.ok(body.message.includes('already'));
  });

  test('9. Expired OTP is rejected with HTTP 400', async () => {
    const { vendorOrder } = await placeOrder('razorpay');

    // Assign to Partner 1
    const assignRes = await fetch(`${baseUrl}/api/delivery/admin/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({
        vendorOrderId: vendorOrder._id.toString(),
        deliveryPartnerId: partnerProfile1._id.toString()
      })
    });
    const assignBody = await assignRes.json();
    const assignmentId = assignBody.data._id;

    // Backdate pickupOtpExpiresAt to past
    await DeliveryAssignment.findByIdAndUpdate(assignmentId, {
      pickupOtpExpiresAt: new Date(Date.now() - 60 * 1000)
    });

    const expiredRes = await fetch(`${baseUrl}/api/delivery/assignments/${assignmentId}/verify-pickup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ otp: '123456' })
    });

    assert.equal(expiredRes.status, 400);
    const body = await expiredRes.json();
    assert.ok(body.message.toLowerCase().includes('expired'));

    // Clean up: Release partner 1 back to available so test 10 can use them.
    // The expired-OTP assignment remains in 'assigned' state; manually free the partner.
    await DeliveryPartnerProfile.findByIdAndUpdate(partnerProfile1._id, {
      availabilityStatus: 'available'
    });
  });

  test('10. Delivery exception reporting & Admin reassignment to new partner', async () => {
    const { vendorOrder } = await placeOrder('razorpay');

    // Partner 2 sets availability to available
    await fetch(`${baseUrl}/api/delivery/availability`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery2}`
      },
      body: JSON.stringify({ availabilityStatus: 'available' })
    });

    // Assign to Partner 1
    const assignRes = await fetch(`${baseUrl}/api/delivery/admin/assign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({
        vendorOrderId: vendorOrder._id.toString(),
        deliveryPartnerId: partnerProfile1._id.toString()
      })
    });
    const assignmentId = (await assignRes.json()).data._id;

    // Partner 1 reports failure
    const failRes = await fetch(`${baseUrl}/api/delivery/assignments/${assignmentId}/report-failure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenDelivery1}`
      },
      body: JSON.stringify({ reason: 'Customer unreachable at delivery address' })
    });

    assert.equal(failRes.status, 200);
    const failBody = await failRes.json();
    assert.equal(failBody.data.status, 'failed');

    // Partner 1 is released back to available
    const p1Check = await DeliveryPartnerProfile.findById(partnerProfile1._id);
    assert.equal(p1Check.availabilityStatus, 'available');
    assert.equal(p1Check.metrics.failedDeliveries, 1);

    // Admin reassigns to Partner 2
    const reassignRes = await fetch(`${baseUrl}/api/delivery/admin/assignments/${assignmentId}/reassign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenAdmin}`
      },
      body: JSON.stringify({
        newDeliveryPartnerId: partnerProfile2._id.toString(),
        reason: 'Customer requested evening redelivery with alternate courier'
      })
    });

    assert.equal(reassignRes.status, 200);
    const reassignBody = await reassignRes.json();
    assert.equal(reassignBody.data.status, 'assigned');
    assert.equal(reassignBody.data.deliveryPartnerId, partnerProfile2._id.toString());

    // Partner 2 is now busy
    const p2Check = await DeliveryPartnerProfile.findById(partnerProfile2._id);
    assert.equal(p2Check.availabilityStatus, 'busy');
  });
});
