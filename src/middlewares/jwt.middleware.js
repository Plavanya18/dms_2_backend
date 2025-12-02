const jwt = require("jsonwebtoken");
const config = require("../config/config");
const { asyncLocalStorage } = require("../context/request.context");
const { getdb } = require("../config/db");
const logger = require("../config/logger");

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "Authorization token is missing" });
    }

    console.log('Authorization Header:', authHeader);

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    console.log('Extracted Token:', token);

    if (!token) {
      return res.status(401).json({ message: "Invalid Authorization header format" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Token has expired" });
      }
      return res.status(401).json({ message: "Invalid token" });
    }

    console.log('Decoded Token without verification:', decoded);

    const session = await getdb.userSession.findFirst({ where: { token } });
    if (!session) return res.status(401).json({ message: "Session not found" });

    if (session.logout_time || session.session_status === "terminated" || session.session_status === "timeout" || session.session_status === "inactive") {
      return res.status(401).json({ message: "Session already logged out" });
    }

    const now = new Date();
    const lastActivity = new Date(session.last_activity);
    const inactiveFor = now - lastActivity;

    if (inactiveFor > INACTIVITY_TIMEOUT_MS) {
      await getdb.userSession.update({
        where: { id: session.id },
        data: { session_status: "timeout", updated_at: now },
      });

      return res.status(401).json({
        message: "Session has been marked inactive due to inactivity timeout",
      });
    }

    await getdb.userSession.update({
      where: { id: session.id },
      data: { last_activity: now, updated_at: now },
    });

    req.user = decoded.user_id;
    req.role = decoded.role_id;
    req.roleName = decoded.roleName;

    asyncLocalStorage.run(new Map(), () => {
      const store = asyncLocalStorage.getStore();
      store.set("token", token);
      store.set("user", decoded);
      next();
    });
  } catch (error) {
    logger.error("Auth middleware: unexpected error", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = { verifyToken };
