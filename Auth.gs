/**
 * Auth.gs - authentication + user management helpers
 * Works with Users sheet: id | email | name | role | is_active | password_hash | salt | created_at | updated_at
 */

var USERS_SHEET_NAME = 'Users';
var TOKEN_STORE_KEY = 'PS_AUTH_TOKENS';
var TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function handleLogin(e, payload) {
  var parsedPayload = payload || parseJsonBody(e && e.postData && e.postData.contents);
  if (!parsedPayload) {
    return createJsonResponse({ success: false, message: 'Invalid login payload' }, 400);
  }

  var email = (parsedPayload.email || '').trim().toLowerCase();
  var password = parsedPayload.password || '';
  if (!email || !password) {
    return createJsonResponse({ success: false, message: 'Email and password required' }, 400);
  }

  var user = findUserByEmail(email);
  if (!user || !user.is_active) {
    return createJsonResponse({ success: false, message: 'Invalid credentials' }, 401);
  }

  var hashed = hashPassword(password, user.salt);
  if (hashed !== user.password_hash) {
    return createJsonResponse({ success: false, message: 'Invalid credentials' }, 401);
  }

  var token = issueToken(user);
  return createJsonResponse({ success: true, token: token, user: sanitizeUser(user) });
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    is_active: user.is_active,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

function isAdmin(user) {
  if (!user) return false;
  var role = (user.role || '').toLowerCase();
  return role === 'admin' || role === 'owner';
}

function getUserFromToken(token) {
  if (!token) return null;
  var tokens = loadTokenStore();
  var record = tokens[token];
  if (!record) return null;
  if (record.expiresAt && record.expiresAt < Date.now()) {
    delete tokens[token];
    saveTokenStore(tokens);
    return null;
  }

  var user = getUserById(record.userId);
  if (!user || !user.is_active) return null;
  return sanitizeUser(user);
}

// Extract token from Authorization header, query params, or body and return user
function requireAuth_(e) {
  var token = '';
  var headers = (e && e.headers) || {};
  var authHeader = headers.Authorization || headers.authorization || '';
  if (authHeader && authHeader.toLowerCase().indexOf('bearer ') === 0) {
    token = authHeader.slice(7).trim();
  }

  if (!token && e && e.parameter && e.parameter.token) {
    token = String(e.parameter.token);
  }

  if (!token && e && e.postData && e.postData.contents) {
    var parsed = parseJsonBody(e.postData.contents);
    if (parsed && parsed.token) {
      token = String(parsed.token);
    }
  }

  var user = getUserFromToken(token);
  if (!user) {
    return { errorResponse: createJsonResponse({ error: 'AUTH', success: false, message: 'Unauthorized' }, 401) };
  }

  return { user: user, token: token };
}

function issueToken(user) {
  var tokens = loadTokenStore();
  var token = Utilities.getUuid();
  tokens[token] = {
    userId: user.id,
    email: user.email,
    role: user.role,
    expiresAt: Date.now() + TOKEN_TTL_MS
  };
  saveTokenStore(tokens);
  return token;
}

function loadTokenStore() {
  var raw = PropertiesService.getScriptProperties().getProperty(TOKEN_STORE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function saveTokenStore(tokens) {
  PropertiesService.getScriptProperties().setProperty(TOKEN_STORE_KEY, JSON.stringify(tokens || {}));
}

function getUsersSheet() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(USERS_SHEET_NAME) || ss.insertSheet(USERS_SHEET_NAME);
}

function getAllUsers() {
  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  var headers = data[0];
  var idx = {};
  headers.forEach(function (h, i) { idx[String(h).trim()] = i; });

  var users = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var user = {
      id: row[idx.id],
      email: (row[idx.email] || '').toString().trim().toLowerCase(),
      name: row[idx.name] || '',
      role: row[idx.role] || 'user',
      is_active: row[idx.is_active] === true || row[idx.is_active] === 'true' || row[idx.is_active] === 'TRUE',
      password_hash: row[idx.password_hash] || '',
      salt: row[idx.salt] || '',
      created_at: row[idx.created_at] || '',
      updated_at: row[idx.updated_at] || ''
    };
    if (user.id) {
      users.push(user);
    }
  }
  return users;
}

function getUserById(id) {
  var list = getAllUsers();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

function findUserByEmail(email) {
  var list = getAllUsers();
  for (var i = 0; i < list.length; i++) {
    if (list[i].email === email) return list[i];
  }
  return null;
}

function hashPassword(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password);
  return Utilities.base64Encode(digest);
}

function generateTempPassword() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function createUser(email, name, role, isActive) {
  var sheet = getUsersSheet();
  var now = new Date().toISOString();
  var id = Utilities.getUuid();
  var salt = Utilities.getUuid();
  var tempPassword = generateTempPassword();
  var hash = hashPassword(tempPassword, salt);

  var row = [
    id,
    email.trim().toLowerCase(),
    name,
    role || 'user',
    isActive !== false,
    hash,
    salt,
    now,
    now
  ];

  sheet.appendRow(row);
  var user = sanitizeUser({
    id: id,
    email: email.trim().toLowerCase(),
    name: name,
    role: role || 'user',
    is_active: isActive !== false,
    password_hash: hash,
    salt: salt,
    created_at: now,
    updated_at: now
  });

  return { user: user, tempPassword: tempPassword };
}

function updateUser(id, updates) {
  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return null;

  var headers = data[0];
  var idx = {};
  headers.forEach(function (h, i) { idx[String(h).trim()] = i; });

  for (var r = 1; r < data.length; r++) {
    if (data[r][idx.id] === id) {
      if (updates.name !== undefined) data[r][idx.name] = updates.name;
      if (updates.role !== undefined) data[r][idx.role] = updates.role;
      if (updates.is_active !== undefined) data[r][idx.is_active] = updates.is_active;
      data[r][idx.updated_at] = new Date().toISOString();
      sheet.getRange(r + 1, 1, 1, data[r].length).setValues([data[r]]);
      return getUserById(id);
    }
  }
  return null;
}

function resetUserPassword(id) {
  var sheet = getUsersSheet();
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return null;

  var headers = data[0];
  var idx = {};
  headers.forEach(function (h, i) { idx[String(h).trim()] = i; });

  for (var r = 1; r < data.length; r++) {
    if (data[r][idx.id] === id) {
      var salt = Utilities.getUuid();
      var tempPassword = generateTempPassword();
      var hash = hashPassword(tempPassword, salt);
      data[r][idx.salt] = salt;
      data[r][idx.password_hash] = hash;
      data[r][idx.updated_at] = new Date().toISOString();
      sheet.getRange(r + 1, 1, 1, data[r].length).setValues([data[r]]);
      return { user: getUserById(id), tempPassword: tempPassword };
    }
  }
  return null;
}

function generateRandomToken_(length) {
  var token = Utilities.getUuid().replace(/-/g, '');
  if (length && length > 0) {
    while (token.length < length) {
      token += Utilities.getUuid().replace(/-/g, '');
    }
    return token.slice(0, length);
  }
  return token;
}

function hashPassword_(password, salt) {
  return hashPassword(password, salt);
}

/**
 * Admin-set password for a user, by id or email.
 * payload: { id?, email?, newPassword }
 */
function adminSetUserPassword_(payload, adminUser) {
  if (!adminUser) {
    throw new Error('Admin user required.');
  }

  var newPassword = (payload.newPassword || '').trim();
  var id = (payload.id || '').trim();
  var email = (payload.email || '').trim().toLowerCase();

  if (!newPassword) {
    throw new Error('New password is required.');
  }

  if (!id && !email) {
    throw new Error('Must provide user id or email.');
  }

  var sheet = getUsersSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error('No users found.');
  }

  var headers = values[0];
  var idx = function(name) { return headers.indexOf(name); };

  var iId        = idx('id');
  var iEmail     = idx('email');
  var iHash      = idx('password_hash');
  var iSalt      = idx('salt');
  var iActive    = idx('is_active');
  var iUpdatedAt = idx('updated_at');

  if (iId < 0 || iEmail < 0 || iHash < 0 || iSalt < 0 || iActive < 0) {
    throw new Error('Users sheet missing one of: id, email, password_hash, salt, is_active.');
  }

  var rowIndex = -1;
  var row;

  for (var r = 1; r < values.length; r++) {
    var vr = values[r];
    var rowId = String(vr[iId] || '');
    var rowEmail = String(vr[iEmail] || '').toLowerCase();

    if ((id && rowId === id) || (email && rowEmail === email)) {
      rowIndex = r + 1; // 1-based
      row = vr;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error('User not found for setPassword.');
  }

  // Generate new salt + hash
  var salt = generateRandomToken_(16);
  var hash = hashPassword_(newPassword, salt);

  row[iHash]      = hash;
  row[iSalt]      = salt;
  row[iActive]    = true;              // ensure active
  if (iUpdatedAt >= 0) {
    row[iUpdatedAt] = new Date();
  }

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);

  return {
    id: row[iId],
    email: row[iEmail],
    is_active: row[iActive]
  };
}

/**
 * Allow a logged-in user to change their own password.
 * - userObj: user object from requireAuth_(e)
 * - currentPassword: string
 * - newPassword: string
 */
function changeOwnPassword_(userObj, currentPassword, newPassword) {
  if (!userObj || !userObj.id) {
    throw new Error('Missing authenticated user.');
  }

  currentPassword = (currentPassword || '').trim();
  newPassword = (newPassword || '').trim();

  if (!currentPassword || !newPassword) {
    throw new Error('Current and new password are required.');
  }

  if (newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }

  // Load Users sheet
  var sheet = getUsersSheet();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    throw new Error('No users found.');
  }

  var headers = values[0];
  var idx = function(name) { return headers.indexOf(name); };

  var iId        = idx('id');
  var iEmail     = idx('email');
  var iHash      = idx('password_hash');
  var iSalt      = idx('salt');
  var iActive    = idx('is_active');
  var iUpdatedAt = idx('updated_at');

  if (iId < 0 || iHash < 0 || iSalt < 0) {
    throw new Error('Users sheet missing id/password columns.');
  }

  // Find this user's row by id
  var rowIndex = -1;
  var row;
  for (var r = 1; r < values.length; r++) {
    var vr = values[r];
    if (String(vr[iId]) === String(userObj.id)) {
      rowIndex = r + 1; // 1-based
      row = vr;
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error('User record not found.');
  }

  var existingSalt = row[iSalt];
  var existingHash = row[iHash];

  // Verify current password matches
  var currentHash = hashPassword_(currentPassword, existingSalt);
  if (currentHash !== existingHash) {
    throw new Error('Current password is incorrect.');
  }

  // Create new salt + hash for the new password
  var newSalt = generateRandomToken_(16);
  var newHash = hashPassword_(newPassword, newSalt);

  row[iSalt] = newSalt;
  row[iHash] = newHash;

  // Ensure user stays active
  if (iActive >= 0 && (row[iActive] === '' || row[iActive] === null)) {
    row[iActive] = true;
  }

  if (iUpdatedAt >= 0) {
    row[iUpdatedAt] = new Date();
  }

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);

  return {
    id: row[iId],
    email: iEmail >= 0 ? row[iEmail] : userObj.email,
    is_active: iActive >= 0 ? row[iActive] : true
  };
}
