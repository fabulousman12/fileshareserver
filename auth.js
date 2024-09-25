const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  // Check if token is missing
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  }

  try {
    // Verify token and decode user information
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Add user information to request

    next(); // Call the next middleware
  } catch (error) {
    console.error('Token verification error:', error); // Log the error for debugging
    // Check the error type and respond accordingly
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ success: false, message: 'Token is not valid' });
    } else if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ success: false, message: 'Token has expired' });
    } else {
      // Handle any other errors
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
};

module.exports = auth;
