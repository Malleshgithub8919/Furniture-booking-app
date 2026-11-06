export function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

export function errorHandler(err, req, res, next) {
  if (err.name === 'OtpDeliveryError') {
    return res.status(err.statusCode || 503).json({
      success: false,
      code: 'OTP_DELIVERY_FAILED',
      message: err.message
    });
  }

  // 1. MongoDB Duplicate Key Error (Code 11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_KEY_ERROR',
      message: `An account with this ${field} already exists.`
    });
  }

  // 2. Mongoose Schema Validation Error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Database validation failed',
      errors: messages
    });
  }

  // 3. JWT Error Handler
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or malformed authentication token.'
    });
  }

  const status = err.statusCode || err.status || 500;
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[Error ${status}]`, err.name || 'Error');
  }

  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : err.message
  });
}
