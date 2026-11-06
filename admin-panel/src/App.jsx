import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Armchair, ArrowDownUp, ArrowLeft, ArrowRight, Bell, Boxes,
  Check, ChevronDown, CircleDollarSign, ClipboardList, CreditCard, LayoutDashboard,
  LogOut, Menu, PackageCheck, Search, ShieldCheck, ShoppingBag, Store, Truck,
  Users, Wallet, X
} from 'lucide-react';
import { apiRequest, clearAdminSession, getAdminSession, loginAdmin, logoutAdmin, queryString } from './api.js';

const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'vendors', label: 'Vendors', icon: Store },
  { id: 'products', label: 'Products', icon: Armchair },
  { id: 'customers', label: 'Customers', icon: Users },
  { id: 'partners', label: 'Delivery partners', icon: Truck },
  { id: 'orders', label: 'Parent orders', icon: ShoppingBag },
  { id: 'vendorOrders', label: 'Vendor orders', icon: Boxes },
  { id: 'payments', label: 'Payments', icon: Wallet },
  { id: 'deliveries', label: 'Deliveries', icon: PackageCheck }
];

const pages = {
  vendors: {
    title: 'Vendor applications',
    description: 'Review marketplace sellers, business information and submitted KYC documents.',
    path: '/admin/vendors',
    rows: result => result.vendors || [],
    pagination: result => result.pagination,
    statuses: ['pending', 'under_review', 'approved', 'rejected', 'suspended'],
    columns: [
      ['Vendor', item => <><strong>{item.storeName}</strong><small>{item.userId?.name || 'Owner unavailable'}</small></>],
      ['Contact', item => item.userId?.email || item.userId?.phone || '—'],
      ['Location', item => [item.address?.city, item.address?.state].filter(Boolean).join(', ') || '—'],
      ['Commission', item => `${item.commissionRate ?? 0}%`],
      ['Status', item => <StatusBadge value={item.status} />]
    ],
    action: 'vendor'
  },
  products: {
    title: 'Product catalog',
    description: 'Moderate listings and manage the visibility status of furniture products.',
    path: '/admin/products',
    rows: result => result.data?.products || [],
    pagination: result => result.data?.pagination,
    statuses: ['draft', 'pending', 'approved', 'rejected', 'inactive'],
    columns: [
      ['Product', item => <><strong>{item.name}</strong><small>{item.sku}</small></>],
      ['Vendor', item => item.vendorId?.storeName || '—'],
      ['Price', item => formatMoney(item.salePrice ?? item.price)],
      ['Stock', item => item.stock ?? '—'],
      ['Status', item => <StatusBadge value={item.status} />]
    ],
    action: 'product'
  },
  customers: {
    title: 'Customers',
    description: 'Search customer accounts and manage access to the marketplace.',
    path: '/admin/customers',
    rows: result => result.data?.customers || [],
    pagination: result => result.data?.pagination,
    statuses: ['active', 'inactive', 'blocked', 'pending_verification'],
    columns: [
      ['Customer', item => <><strong>{item.name}</strong><small>{item.email || 'No email'}</small></>],
      ['Phone', item => item.phone || '—'],
      ['Joined', item => formatDate(item.createdAt)],
      ['Last sign-in', item => formatDate(item.lastLoginAt)],
      ['Status', item => <StatusBadge value={item.status} />]
    ],
    action: 'customer'
  },
  partners: {
    title: 'Delivery partners',
    description: 'Review partner applications and monitor availability.',
    path: '/delivery/admin/partners',
    rows: result => result.data?.partners || [],
    pagination: result => result.data?.pagination,
    statuses: ['pending', 'approved', 'rejected', 'suspended'],
    columns: [
      ['Partner', item => <><strong>{item.userId?.name || 'Partner'}</strong><small>{item.userId?.email || item.userId?.phone || '—'}</small></>],
      ['Vehicle', item => <>{formatLabel(item.vehicleType)}<small>{item.vehicleNumber}</small></>],
      ['Deliveries', item => item.metrics?.successfulDeliveries ?? 0],
      ['Availability', item => <StatusBadge value={item.availabilityStatus} />],
      ['Review status', item => <StatusBadge value={item.approvalStatus} />]
    ],
    action: 'partner'
  },
  orders: {
    title: 'Parent orders',
    description: 'Track customer orders, payment state and fulfillment progress.',
    path: '/admin/orders',
    rows: result => result.data?.orders || [],
    pagination: result => result.data?.pagination,
    statuses: ['placed', 'partially_cancelled', 'cancelled', 'completed'],
    columns: [
      ['Order', item => <><strong>{item.orderNumber}</strong><small>{formatDate(item.createdAt)}</small></>],
      ['Customer', item => <>{item.userId?.name || '—'}<small>{item.userId?.email || ''}</small></>],
      ['Total', item => formatMoney(item.pricing?.grandTotal)],
      ['Payment', item => <StatusBadge value={item.paymentStatus} />],
      ['Order status', item => <StatusBadge value={item.orderStatus} />]
    ]
  },
  vendorOrders: {
    title: 'Vendor orders',
    description: 'Inspect the fulfillment status of vendor-specific order splits.',
    path: '/admin/vendor-orders',
    rows: result => result.data?.vendorOrders || [],
    pagination: result => result.data?.pagination,
    statuses: ['placed', 'confirmed', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled'],
    columns: [
      ['Sub-order', item => <><strong>{item.subOrderNumber}</strong><small>{item.parentOrderId?.orderNumber || '—'}</small></>],
      ['Vendor', item => item.vendorId?.storeName || '—'],
      ['Customer', item => item.customerId?.name || '—'],
      ['Total', item => formatMoney(item.pricing?.grandTotal)],
      ['Status', item => <StatusBadge value={item.status} />]
    ]
  },
  payments: {
    title: 'Payments',
    description: 'Read-only transaction monitoring for Razorpay and cash-on-delivery records.',
    path: '/admin/payments',
    rows: result => result.data?.payments || [],
    pagination: result => result.data?.pagination,
    statuses: ['pending', 'authorized', 'captured', 'failed', 'refunded'],
    columns: [
      ['Order', item => <><strong>{item.orderId?.orderNumber || '—'}</strong><small>{item.userId?.name || ''}</small></>],
      ['Method', item => <><strong>{item.gateway?.toUpperCase()}</strong><small>{item.method || ''}</small></>],
      ['Transaction', item => <><span className="mono">{item.gatewayPaymentId || item.gatewayOrderId || '—'}</span><small>{item.gatewayPaymentId ? 'Payment reference' : 'Order reference'}</small></>],
      ['Amount', item => formatMoney(item.amount, item.currency)],
      ['Status', item => <StatusBadge value={item.status} />]
    ]
  },
  deliveries: {
    title: 'Delivery assignments',
    description: 'Monitor pickup and handover progress, and assign or reassign a partner.',
    path: '/delivery/admin/assignments',
    rows: result => result.data?.assignments || [],
    pagination: result => result.data?.pagination,
    statuses: ['assigned', 'arrived_at_vendor', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'cancelled'],
    columns: [
      ['Assignment', item => <><strong>{item.assignmentNumber}</strong><small>{item.vendorOrderId?.subOrderNumber || '—'}</small></>],
      ['Partner', item => <>{item.deliveryUserId?.name || '—'}<small>{item.deliveryPartnerId?.vehicleNumber || ''}</small></>],
      ['COD due', item => formatMoney(item.codAmountDue)],
      ['Pickup', item => item.pickupVerifiedAt ? formatDate(item.pickupVerifiedAt) : 'Pending'],
      ['Delivery status', item => <StatusBadge value={item.status} />]
    ],
    action: 'delivery'
  }
};

function formatLabel(value = '') {
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase()) || '—';
}

function formatMoney(value, currency = 'INR') {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) / 100);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date);
}

function StatusBadge({ value }) {
  return <span className={`status-badge status-${String(value || 'unknown').toLowerCase()}`}>{formatLabel(value || 'unknown')}</span>;
}

function ErrorMessage({ children }) {
  return children ? <div className="inline-error" role="alert">{children}</div> : null;
}

function LoginPage({ onLogin }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onLogin(identifier.trim(), password);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-shell">
    <section className="login-card">
      <div className="brand-lockup"><span className="brand-mark">F</span><div>FurniSpace<small>MARKETPLACE ADMIN</small></div></div>
      <div className="login-intro"><span className="eyebrow">SECURE ADMIN PORTAL</span><h1>Welcome back</h1><p>Sign in with an administrator account to continue.</p></div>
      <form onSubmit={submit} className="login-form">
        <label>Email or mobile number<input autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <ErrorMessage>{error}</ErrorMessage>
        <button className="primary-button wide" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
      </form>
      <p className="login-foot"><ShieldCheck size={15} /> Access is restricted to accounts with the admin role.</p>
    </section>
  </main>;
}

function Sidebar({ active, onNavigate, onLogout, user, busy }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <>
    <button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={19} /></button>
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><span className="brand-mark">F</span><div>FurniSpace<small>MARKETPLACE ADMIN</small></div></div>
      <div className="sidebar-section">WORKSPACE</div>
      <nav aria-label="Admin navigation">
        {navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${active === id ? 'nav-active' : ''}`} onClick={() => { onNavigate(id); setMobileOpen(false); }}>
          <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === 'vendors' && <span className="nav-indicator" />}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="security-note"><ShieldCheck size={16} /><span>Protected admin workspace</span></div>
        <button className="nav-item logout-link" onClick={onLogout} disabled={busy}><LogOut size={17} /><span>{busy ? 'Signing out…' : 'Sign out'}</span></button>
      </div>
    </aside>
  </>;
}

function Header({ page, user, onLogout, busy }) {
  const heading = page === 'overview' ? 'Marketplace overview' : navigation.find(item => item.id === page)?.label || 'Admin';
  return <header className="topbar">
    <div><span className="eyebrow">ADMINISTRATION / {heading.toUpperCase()}</span><h1>{heading}</h1><p>Manage operations across your furniture marketplace.</p></div>
    <div className="topbar-actions"><span className="secure-pill"><ShieldCheck size={14} /> Secure session</span><button className="icon-button" aria-label="Notifications"><Bell size={18} /></button>
      <div className="admin-identity"><span className="avatar">{(user?.name || 'A').slice(0, 1).toUpperCase()}</span><div><strong>{user?.name || 'Administrator'}</strong><small>Administrator</small></div><ChevronDown size={15} /></div>
      <button className="icon-button top-logout" aria-label="Sign out" onClick={onLogout} disabled={busy}><LogOut size={17} /></button>
    </div>
  </header>;
}

function Dashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest('/admin/dashboard');
      setData(result.data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const totals = data?.totals || {};
  const stats = [
    { label: 'Customers', value: totals.customers, icon: Users, tone: 'sage', target: 'customers' },
    { label: 'Vendors', value: totals.vendors, icon: Store, tone: 'blue', target: 'vendors' },
    { label: 'Products', value: totals.products, icon: Armchair, tone: 'amber', target: 'products' },
    { label: 'Parent orders', value: totals.orders, icon: ShoppingBag, tone: 'plum', target: 'orders' }
  ];
  const paymentCount = (data?.paymentStats || []).reduce((total, item) => total + item.count, 0);
  const paymentValue = (data?.paymentStats || []).reduce((total, item) => total + item.amount, 0);

  return <section>
    <div className="page-welcome"><div><span className="eyebrow">LIVE MARKETPLACE METRICS</span><h2>Good to see you, admin</h2><p>Here’s the current health of your marketplace operations.</p></div><button className="secondary-button" onClick={load} disabled={loading}><Activity size={16} /> {loading ? 'Refreshing…' : 'Refresh data'}</button></div>
    <ErrorMessage>{error}</ErrorMessage>
    <div className="stats-grid">
      {stats.map(({ label, value, icon: Icon, tone, target }) => <button className="metric-card" key={label} onClick={() => onNavigate(target)}>
        <div className={`metric-icon ${tone}`}><Icon size={19} /></div><div className="metric-label">{label}<ArrowDownUp size={13} /></div><strong>{loading ? '—' : (value ?? 0).toLocaleString('en-IN')}</strong><small>Marketplace total</small>
      </button>)}
    </div>
    <div className="dashboard-grid">
      <article className="content-card review-card">
        <div className="card-heading"><div><span className="eyebrow">NEEDS ATTENTION</span><h3>Review queue</h3></div><ClipboardList size={19} /></div>
        <button className="review-row" onClick={() => onNavigate('vendors')}><span className="review-icon amber"><Store size={17} /></span><span><strong>Vendor applications</strong><small>New and in-review profiles</small></span><b>{loading ? '—' : data?.reviewQueue?.pendingVendors ?? 0}</b><ArrowRight size={15} /></button>
        <button className="review-row" onClick={() => onNavigate('products')}><span className="review-icon blue"><Armchair size={17} /></span><span><strong>Product approvals</strong><small>Listings awaiting moderation</small></span><b>{loading ? '—' : data?.reviewQueue?.pendingProducts ?? 0}</b><ArrowRight size={15} /></button>
      </article>
      <article className="content-card payments-summary">
        <div className="card-heading"><div><span className="eyebrow">PAYMENT MONITORING</span><h3>Payment activity</h3></div><CreditCard size={19} /></div>
        <div className="payment-total"><div className="payment-icon"><CircleDollarSign size={20} /></div><div><small>Recorded transaction value</small><strong>{loading ? '—' : formatMoney(paymentValue)}</strong></div></div>
        <div className="payment-summary-footer"><span><b>{loading ? '—' : paymentCount.toLocaleString('en-IN')}</b> transactions</span><button className="text-button" onClick={() => onNavigate('payments')}>View payments <ArrowRight size={14} /></button></div>
      </article>
    </div>
    <article className="content-card gateway-card">
      <div className="card-heading"><div><span className="eyebrow">BY GATEWAY AND STATUS</span><h3>Payment statistics</h3></div><Wallet size={19} /></div>
      {loading ? <LoadingState /> : data?.paymentStats?.length ? <div className="gateway-grid">{data.paymentStats.map(item => <div className="gateway-cell" key={`${item.gateway}-${item.status}`}><span>{item.gateway.toUpperCase()} · {formatLabel(item.status)}</span><strong>{item.count} <small>payments</small></strong><b>{formatMoney(item.amount)}</b></div>)}</div> : <EmptyState title="No payment records" detail="Payment statistics will appear here when transactions are recorded." />}
    </article>
  </section>;
}

function LoadingState() {
  return <div className="state-box"><span className="spinner" /><strong>Loading records…</strong></div>;
}

function EmptyState({ title, detail }) {
  return <div className="state-box empty-state"><PackageCheck size={24} /><strong>{title}</strong><span>{detail}</span></div>;
}

function SectionPage({ pageId, onStatus, onVendorDetails, onReassign, onAssign }) {
  const config = pages[pageId];
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [gateway, setGateway] = useState('');
  const [availability, setAvailability] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch, status, availability, gateway, pageId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = { page, limit: 12, search: debouncedSearch };
    if (pageId === 'partners') {
      params.approvalStatus = status;
      params.availabilityStatus = availability;
    } else if (pageId === 'payments') {
      params.status = status;
      params.gateway = gateway;
    } else {
      params.status = status;
    }
    try {
      const result = await apiRequest(`${config.path}?${queryString(params)}`);
      setRows(config.rows(result));
      setPagination(config.pagination(result) || { page: 1, pages: 1, total: config.rows(result).length });
    } catch (loadError) {
      setRows([]);
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [config, page, debouncedSearch, status, availability, gateway, pageId]);

  useEffect(() => { load(); }, [load]);

  const headers = config.columns.map(([label]) => label);
  const showActions = Boolean(config.action);
  const actionButtons = item => {
    if (config.action === 'vendor') return <><button className="table-action" onClick={() => onVendorDetails(item)}>Review</button>{item.status !== 'approved' && <button className="table-action positive" onClick={() => onStatus({ kind: 'vendor', item, status: 'approved' })}>Approve</button>}</>;
    if (config.action === 'product') return <><button className="table-action" onClick={() => onStatus({ kind: 'product', item, status: 'inactive' })}>Deactivate</button>{item.status !== 'approved' && <button className="table-action positive" onClick={() => onStatus({ kind: 'product', item, status: 'approved' })}>Approve</button>}{item.status !== 'rejected' && <button className="table-action danger" onClick={() => onStatus({ kind: 'product', item, status: 'rejected' })}>Reject</button>}</>;
    if (config.action === 'customer') return <button className={`table-action ${item.status === 'blocked' ? 'positive' : 'danger'}`} onClick={() => onStatus({ kind: 'customer', item, status: item.status === 'blocked' ? 'active' : 'blocked' })}>{item.status === 'blocked' ? 'Restore' : 'Block'}</button>;
    if (config.action === 'partner') return <><button className="table-action positive" onClick={() => onStatus({ kind: 'partner', item, status: 'approved' })}>Approve</button>{item.approvalStatus !== 'rejected' && <button className="table-action danger" onClick={() => onStatus({ kind: 'partner', item, status: 'rejected' })}>Reject</button>}<button className="table-action" onClick={() => onStatus({ kind: 'partner', item, status: item.approvalStatus === 'suspended' ? 'approved' : 'suspended' })}>{item.approvalStatus === 'suspended' ? 'Reinstate' : 'Suspend'}</button>{item.approvalStatus === 'approved' && (item.availabilityStatus === 'busy' ? <button className="table-action" disabled>On active route</button> : <button className="table-action" onClick={() => onStatus({ kind: 'partnerAvailability', item, status: item.availabilityStatus === 'offline' ? 'available' : 'offline' })}>{item.availabilityStatus === 'offline' ? 'Set available' : 'Set offline'}</button>)}</>;
    if (config.action === 'delivery') return ['delivered', 'failed', 'cancelled'].includes(item.status) ? <button className="table-action" disabled>Final status</button> : <button className="table-action" onClick={() => onReassign(item)}>{item.status === 'assigned' ? 'Reassign' : 'Change partner'}</button>;
    return null;
  };

  return <section className="data-page">
    <div className="section-intro"><div><span className="eyebrow">OPERATIONS</span><h2>{config.title}</h2><p>{config.description}</p></div>{pageId === 'deliveries' && <button className="primary-button" onClick={() => onAssign()}><Truck size={16} /> Assign delivery</button>}</div>
    <div className="toolbar">
      <label className="search-field"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${config.title.toLowerCase()}…`} aria-label={`Search ${config.title}`} /></label>
      <div className="filter-control"><span>Filter</span><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{config.statuses.map(value => <option value={value} key={value}>{formatLabel(value)}</option>)}</select></div>
      {pageId === 'partners' && <div className="filter-control availability-filter"><span>Availability</span><select value={availability} onChange={event => setAvailability(event.target.value)} aria-label="Filter availability"><option value="">Any availability</option>{['available', 'busy', 'offline'].map(value => <option key={value} value={value}>{formatLabel(value)}</option>)}</select></div>}
      {pageId === 'payments' && <div className="filter-control"><span>Gateway</span><select value={gateway} onChange={event => setGateway(event.target.value)} aria-label="Filter payment gateway"><option value="">All gateways</option><option value="razorpay">Razorpay</option><option value="cod">Cash on delivery</option></select></div>}
      {pageId === 'payments' && <span className="read-only-label"><ShieldCheck size={14} /> View only</span>}
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <div className="table-card">
      {loading ? <LoadingState /> : rows.length === 0 ? <EmptyState title="Nothing to show" detail={debouncedSearch || status ? 'Try adjusting your search or filters.' : 'Records will appear here when available.'} /> : <div className="table-scroll">
        <table><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}{showActions && <th className="actions-heading">Actions</th>}</tr></thead>
          <tbody>{rows.map(item => <tr key={item._id || item.assignmentNumber}>{config.columns.map(([label, render]) => <td key={label}>{render(item)}</td>)}{showActions && <td className="row-actions">{actionButtons(item)}</td>}</tr>)}</tbody>
        </table>
      </div>}
      <div className="table-footer"><span>{pagination.total ?? rows.length} records</span><div><button className="page-button" disabled={loading || page <= 1} onClick={() => setPage(current => current - 1)} aria-label="Previous page"><ArrowLeft size={15} /></button><span>Page {pagination.page || page} of {Math.max(pagination.pages || 1, 1)}</span><button className="page-button" disabled={loading || page >= (pagination.pages || 1)} onClick={() => setPage(current => current + 1)} aria-label="Next page"><ArrowRight size={15} /></button></div></div>
    </div>
  </section>;
}

function ActionDialog({ action, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  if (!action) return null;
  const rejectionNeedsReason = action.status === 'rejected';
  const title = action.status === 'blocked' ? 'Block customer access?' : action.kind === 'partnerAvailability' ? `Set partner ${formatLabel(action.status).toLowerCase()}?` : `${formatLabel(action.status)} ${action.kind}?`;
  const body = action.status === 'blocked'
    ? 'This customer will no longer be able to access their account.'
    : `${action.item?.name || action.item?.storeName || action.item?.userId?.name || 'This record'} will be updated.`;
  return <Modal title={title} onClose={onClose}>
    <p className="dialog-copy">{body}</p>
    {rejectionNeedsReason && <label className="form-field">Reason for rejection<textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} minLength={5} required placeholder="Add a clear reason for the applicant" /></label>}
    <ErrorMessage>{action.error}</ErrorMessage>
    <div className="dialog-actions"><button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className={`primary-button ${action.status === 'rejected' || action.status === 'blocked' ? 'button-danger' : ''}`} onClick={() => onConfirm(action, reason)} disabled={busy || (rejectionNeedsReason && reason.trim().length < 5)}>{busy ? 'Saving…' : 'Confirm'}</button></div>
  </Modal>;
}

function VendorDetails({ vendorId, onClose, onReview }) {
  const [vendor, setVendor] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    apiRequest(`/admin/vendors/${vendorId}`).then(result => { if (active) setVendor(result.vendor); })
      .catch(loadError => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [vendorId]);
  return <Modal title="Vendor application" onClose={onClose} wide>
    {loading ? <LoadingState /> : error ? <ErrorMessage>{error}</ErrorMessage> : vendor && <>
      <div className="detail-grid"><div><span>Business</span><strong>{vendor.storeName}</strong></div><div><span>Owner</span><strong>{vendor.userId?.name || '—'}</strong></div><div><span>Email</span><strong>{vendor.userId?.email || '—'}</strong></div><div><span>Phone</span><strong>{vendor.userId?.phone || '—'}</strong></div><div><span>Business type</span><strong>{formatLabel(vendor.businessType)}</strong></div><div><span>Location</span><strong>{[vendor.address?.city, vendor.address?.state, vendor.address?.postalCode].filter(Boolean).join(', ') || '—'}</strong></div><div><span>GSTIN</span><strong>{vendor.gstin || 'Not provided'}</strong></div><div><span>PAN</span><strong>{vendor.pan || 'Not provided'}</strong></div></div>
      <div className="kyc-heading"><div><h3>Submitted KYC documents</h3><p>Document data is visible only to authorized admins.</p></div><StatusBadge value={vendor.status} /></div>
      {vendor.kycDocuments?.length ? <div className="kyc-list">{vendor.kycDocuments.map(document => <article className="kyc-document" key={document._id}><div className="document-icon"><ShieldCheck size={17} /></div><div className="document-info"><strong>{formatLabel(document.documentType)}</strong><small>{document.originalName} · {formatDate(document.uploadedAt)}</small><StatusBadge value={document.status} /></div><div className="document-actions">{document.status !== 'verified' && <button className="table-action positive" onClick={() => onReview(vendor._id, document, 'verified')}>Verify</button>}{document.status !== 'rejected' && <button className="table-action danger" onClick={() => onReview(vendor._id, document, 'rejected')}>Reject</button>}</div></article>)}</div> : <EmptyState title="No KYC documents submitted" detail="The vendor has not registered any KYC document metadata." />}
      <div className="dialog-actions vendor-review-actions"><StatusBadge value={vendor.status} /><div><button className="secondary-button" onClick={() => onReview(vendor._id, null, 'suspended')}>Suspend</button><button className="primary-button" onClick={() => onReview(vendor._id, null, 'approved')}><Check size={15} /> Approve vendor</button></div></div>
    </>}
  </Modal>;
}

function Modal({ title, children, onClose, wide = false }) {
  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={17} /></button></header>
      <div className="modal-content">{children}</div>
    </section>
  </div>;
}

function AssignmentDialog({ existing, onClose, onComplete }) {
  const [orders, setOrders] = useState([]);
  const [partners, setPartners] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest(`/admin/vendor-orders?${queryString({ limit: 100 })}`),
      apiRequest(`/delivery/admin/partners?${queryString({ approvalStatus: 'approved', availabilityStatus: 'available', limit: 100 })}`)
    ]).then(([ordersResult, partnersResult]) => {
      if (!active) return;
      setOrders((ordersResult.data?.vendorOrders || []).filter(order => !['delivered', 'cancelled'].includes(order.status)));
      setPartners(partnersResult.data?.partners || []);
    }).catch(loadError => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (existing) {
        await apiRequest(`/delivery/admin/assignments/${existing._id}/reassign`, {
          method: 'POST',
          body: { newDeliveryPartnerId: partnerId, reason }
        });
      } else {
        await apiRequest('/delivery/admin/assign', {
          method: 'POST',
          body: { vendorOrderId: orderId, deliveryPartnerId: partnerId }
        });
      }
      await onComplete();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={existing ? 'Reassign delivery' : 'Assign delivery partner'} onClose={onClose}>
    {loading ? <LoadingState /> : <form className="assignment-form" onSubmit={submit}>
      {!existing && <label className="form-field">Vendor order<select required value={orderId} onChange={event => setOrderId(event.target.value)}><option value="">Select an order</option>{orders.map(order => <option key={order._id} value={order._id}>{order.subOrderNumber} · {order.vendorId?.storeName || 'Vendor'} · {formatLabel(order.status)}</option>)}</select></label>}
      <label className="form-field">{existing ? 'New delivery partner' : 'Available delivery partner'}<select required value={partnerId} onChange={event => setPartnerId(event.target.value)}><option value="">Select a partner</option>{partners.filter(partner => !existing || String(partner._id) !== String(existing.deliveryPartnerId?._id)).map(partner => <option key={partner._id} value={partner._id}>{partner.userId?.name || 'Partner'} · {partner.vehicleNumber}</option>)}</select></label>
      {existing && <label className="form-field">Reason for reassignment<textarea rows={3} required minLength={5} value={reason} onChange={event => setReason(event.target.value)} placeholder="At least 5 characters" /></label>}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" type="submit" disabled={busy || !partnerId || (!existing && !orderId) || (existing && reason.trim().length < 5)}>{busy ? 'Saving…' : existing ? 'Reassign partner' : 'Assign partner'}</button></div>
    </form>}
  </Modal>;
}

export default function App() {
  const initialSession = useMemo(() => getAdminSession(), []);
  const [user, setUser] = useState(initialSession.user?.role === 'admin' ? initialSession.user : null);
  const [checkingSession, setCheckingSession] = useState(Boolean(initialSession.accessToken));
  const [page, setPage] = useState(() => {
    const requestedPage = window.location.hash.slice(1);
    return navigation.some(item => item.id === requestedPage) ? requestedPage : 'overview';
  });
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [action, setAction] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [assignment, setAssignment] = useState(null);
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);

  const navigate = useCallback(nextPage => {
    const safePage = navigation.some(item => item.id === nextPage) ? nextPage : 'overview';
    setPage(safePage);
    window.location.hash = safePage;
  }, []);

  useEffect(() => {
    const handleHash = () => {
      const next = window.location.hash.slice(1);
      setPage(navigation.some(item => item.id === next) ? next : 'overview');
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    if (!initialSession.accessToken) {
      setCheckingSession(false);
      return;
    }
    let active = true;
    apiRequest('/auth/me').then(result => {
      if (result.user?.role !== 'admin') throw new Error('This account does not have admin access.');
      if (active) setUser(result.user);
    }).catch(() => {
      clearAdminSession();
      if (active) setUser(null);
    }).finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, [initialSession.accessToken]);

  async function handleLogin(identifier, password) {
    const adminUser = await loginAdmin(identifier, password);
    setUser(adminUser);
    setLogoutError('');
  }

  async function handleLogout() {
    setLogoutBusy(true);
    setLogoutError('');
    try {
      await logoutAdmin();
    } catch (error) {
      setLogoutError(error.message);
    } finally {
      setUser(null);
      setLogoutBusy(false);
    }
  }

  async function saveAction(selectedAction, reason) {
    setActionBusy(true);
    try {
      const { kind, item, status } = selectedAction;
      if (kind === 'vendor') {
        await apiRequest(`/admin/vendors/${item._id}/status`, { method: 'PATCH', body: { status, ...(reason ? { rejectionReason: reason } : {}) } });
      } else if (kind === 'product') {
        await apiRequest(`/admin/products/${item._id}/status`, { method: 'PATCH', body: { status, ...(reason ? { rejectionReason: reason } : {}) } });
      } else if (kind === 'customer') {
        await apiRequest(`/admin/customers/${item._id}/status`, { method: 'PATCH', body: { status } });
      } else if (kind === 'partner') {
        await apiRequest(`/delivery/admin/partners/${item._id}/status`, { method: 'PATCH', body: { status, ...(reason ? { rejectionReason: reason } : {}) } });
      } else if (kind === 'partnerAvailability') {
        await apiRequest(`/delivery/admin/partners/${item._id}/availability`, { method: 'PATCH', body: { availabilityStatus: status } });
      } else if (kind === 'kyc') {
        const path = `/admin/vendors/${item.vendorId}/kyc/${item.documentId}`;
        await apiRequest(path, { method: 'PATCH', body: { status, ...(reason ? { rejectionReason: reason } : {}) } });
      }
      setAction(null);
      setVendorId('');
      setAssignmentRefresh(value => value + 1);
    } catch (error) {
      setAction({ ...selectedAction, error: error.message });
    } finally {
      setActionBusy(false);
    }
  }

  if (checkingSession) return <main className="session-check"><span className="spinner" /><span>Verifying administrator session…</span></main>;
  if (!user) return <><LoginPage onLogin={handleLogin} />{logoutError && <div className="logout-error" role="alert">{logoutError}</div>}</>;

  return <div className="app-shell">
    <Sidebar active={page} onNavigate={navigate} onLogout={handleLogout} user={user} busy={logoutBusy} />
    <main className="main-content"><Header page={page} user={user} onLogout={handleLogout} busy={logoutBusy} />
      {logoutError && <ErrorMessage>{logoutError}</ErrorMessage>}
      {page === 'overview' ? <Dashboard onNavigate={navigate} /> : <SectionPage key={`${page}-${assignmentRefresh}`} pageId={page} onStatus={setAction} onVendorDetails={item => setVendorId(item._id)} onReassign={setAssignment} onAssign={() => setAssignment({})} />}
      <footer className="app-footer"><span>FurniSpace Admin</span><span>Protected marketplace operations</span></footer>
    </main>
    <ActionDialog action={action} onClose={() => setAction(null)} onConfirm={saveAction} busy={actionBusy} />
    {vendorId && <VendorDetails vendorId={vendorId} onClose={() => setVendorId('')} onReview={(id, document, status) => {
      setVendorId('');
      if (document) {
        setAction({ kind: 'kyc', item: { vendorId: id, documentId: document._id, name: formatLabel(document.documentType) }, status });
      } else {
        setAction({ kind: 'vendor', item: { _id: id, storeName: 'Vendor application' }, status });
      }
    }} />}
    {assignment && <AssignmentDialog existing={assignment._id ? assignment : null} onClose={() => setAssignment(null)} onComplete={async () => {
      setAssignment(null);
      setAssignmentRefresh(value => value + 1);
    }} />}
  </div>;
}
