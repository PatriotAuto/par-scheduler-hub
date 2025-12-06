/**
 * MainBackend.gs - API entrypoint for Patriot Scheduler
 * Adds user management endpoints and dispatch for GET/POST actions.
 */

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action)
      ? e.parameter.action
      : 'loadAppointments';

    // --- LOGIN via GET (no auth required) ---
    if (action === 'login') {
      try {
        var body = {
          email: (e.parameter && e.parameter.email) ? String(e.parameter.email).trim() : '',
          password: (e.parameter && e.parameter.password) ? String(e.parameter.password) : ''
        };
        return handleLogin(e, body);
      } catch (err) {
        return createJsonResponse({
          success: false,
          error: 'LOGIN_ERROR',
          message: String(err)
        });
      }
    }

    // --- AUTH: change own password via GET (requires token) ---
    if (action === 'changePassword') {
      try {
        var session = requireAuth_(e); // from Auth.gs
        if (session && session.errorResponse) return session.errorResponse;
        var currentUser = session.user;
        var currentPassword = (e.parameter && e.parameter.currentPassword) ? String(e.parameter.currentPassword) : '';
        var newPassword = (e.parameter && e.parameter.newPassword) ? String(e.parameter.newPassword) : '';

        var updated = changeOwnPassword_(currentUser, currentPassword, newPassword);

        return createJsonResponse({
          success: true,
          user: {
            id: updated.id,
            email: updated.email
          }
        });
      } catch (err) {
        return createJsonResponse({
          success: false,
          error: 'CHANGE_PASSWORD_ERROR',
          message: String(err)
        });
      }
    }

    // --- Admin: set user password via GET ---
    if (action === 'users.setPassword') {
      try {
        var currentUser = requireAuth_(e);
        if (currentUser && currentUser.errorResponse) return currentUser.errorResponse;
        currentUser = currentUser.user;

        var payloadSet = {
          id: (e.parameter && e.parameter.id) ? String(e.parameter.id).trim() : '',
          email: (e.parameter && e.parameter.email) ? String(e.parameter.email).trim() : '',
          newPassword: (e.parameter && e.parameter.newPassword) ? String(e.parameter.newPassword) : ''
        };

        var updated = adminSetUserPassword_(payloadSet, currentUser);

        return createJsonResponse({
          success: true,
          ok: true,
          user: updated
        });
      } catch (err) {
        return createJsonResponse({
          success: false,
          ok: false,
          error: 'USERS_SET_PASSWORD_ERROR',
          message: String(err)
        });
      }
    }

    // === COMPAT MODE: public GET endpoints (no auth required) ===
    var PUBLIC_GET_ACTIONS = {
      'loadAppointments': true,
      'loadTechSchedules': true,
      'loadTechTimeOff': true,
      'loadServices': true,
      'crm.listCustomers': true,
      'crm.listCustomerAppointments': true,
      'getEmployees': true,
      'getServices': true,
      'getDepartments': true,
      'loadHolidays': true,
      'getTimeOff': true
    };

    // Only require auth if this action is NOT in the public list
    var authedUser = null;
    if (!PUBLIC_GET_ACTIONS[action]) {
      var session = requireAuth_(e);
      if (session && session.errorResponse) return session.errorResponse;
      authedUser = session.user;
    }

    return handleRequest('GET', e || {}, {
      actionOverride: action,
      skipAuth: !!PUBLIC_GET_ACTIONS[action],
      authedUser: authedUser
    });
  } catch (err) {
    return createJsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  return handleRequest('POST', e || {});
}

function handleRequest(method, e, options) {
  var opts = options || {};
  var action = opts.actionOverride || (e.parameter && e.parameter.action) || '';
  var body = null;

  if (method === 'POST' && e.postData) {
    body = parseJsonBody(e.postData && e.postData.contents);
    if (!action && body && body.action) {
      action = String(body.action);
    }
  }

  if (!action) {
    return createJsonResponse({ success: false, message: 'Missing action' }, 400);
  }

  if (method === 'POST' && !e.postData && action !== 'login') {
    return createJsonResponse({ success: false, message: 'Missing post data' }, 400);
  }

  // Public action: login
  if (action === 'login') {
    if (method === 'GET') {
      var payload = {
        email: (e.parameter && e.parameter.email) ? String(e.parameter.email).trim().toLowerCase() : '',
        password: (e.parameter && e.parameter.password) ? String(e.parameter.password) : ''
      };
      return handleLogin(e, payload);
    }

    if (method === 'POST') {
      return handleLogin(e);
    }
  }

  // Authenticated actions
  var authedUser = opts.authedUser || null;
  if (!opts.skipAuth && !authedUser) {
    var session = requireAuth_(e);
    if (session && session.errorResponse) return session.errorResponse;
    authedUser = session.user;
  }

  // Dispatch
  var adminCheck;
  if (action === 'users.list') {
    adminCheck = requireAdminUser_(authedUser);
    if (adminCheck && adminCheck.errorResponse) return adminCheck.errorResponse;
    return handleUsersList(adminCheck.user);
  }
  if (action === 'users.create') {
    adminCheck = requireAdminUser_(authedUser);
    if (adminCheck && adminCheck.errorResponse) return adminCheck.errorResponse;
    if (method === 'POST') return handleUsersCreate(adminCheck.user, e);
    return handleUsersCreateGet(adminCheck.user, e);
  }
  if (action === 'users.setActive') {
    adminCheck = requireAdminUser_(authedUser);
    if (adminCheck && adminCheck.errorResponse) return adminCheck.errorResponse;
    return handleUsersSetActiveGet(adminCheck.user, e);
  }
  if (action === 'users.setPassword') {
    adminCheck = requireAdminUser_(authedUser);
    if (adminCheck && adminCheck.errorResponse) return adminCheck.errorResponse;
    return handleUsersSetPasswordGet(adminCheck.user, e);
  }
  if (action === 'users.update' && method === 'POST') return handleUsersUpdate(authedUser, e);
  if (action === 'users.resetPassword') {
    adminCheck = requireAdminUser_(authedUser);
    if (adminCheck && adminCheck.errorResponse) return adminCheck.errorResponse;
    if (method === 'POST') return handleUsersResetPassword(adminCheck.user, e);
    return handleUsersResetPasswordGet(adminCheck.user, e);
  }

  return createJsonResponse({ success: false, message: 'Unknown action' }, 404);
}

function requireAdminUser_(user) {
  if (!user) {
    return { errorResponse: createJsonResponse({ error: 'AUTH', success: false, message: 'Unauthorized' }, 401) };
  }

  if (!isAdmin(user)) {
    return { errorResponse: createJsonResponse({ error: 'AUTH', success: false, message: 'Admin only' }, 403) };
  }

  return { user: user };
}

function handleUsersList(currentUser) {
  if (!isAdmin(currentUser)) {
    return createJsonResponse({ error: 'AUTH', success: false, message: 'Admin only' }, 403);
  }

  var users = getAllUsers().map(function (u) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      is_active: u.is_active,
      created_at: u.created_at,
      updated_at: u.updated_at
    };
  });

  return createJsonResponse({ success: true, users: users });
}

function handleUsersCreate(currentUser, e) {
  if (!isAdmin(currentUser)) {
    return createJsonResponse({ error: 'AUTH', success: false, message: 'Admin only' }, 403);
  }

  var body = parseJsonBody(e.postData && e.postData.contents);
  if (!body || !body.email || !body.name) {
    return createJsonResponse({ success: false, message: 'Missing email or name' }, 400);
  }

  var role = body.role || 'user';
  var isActive = body.is_active !== false;

  var created = createUser(body.email, body.name, role, isActive);
  return createJsonResponse({ success: true, user: created.user, tempPassword: created.tempPassword });
}

function handleUsersUpdate(currentUser, e) {
  if (!isAdmin(currentUser)) {
    return createJsonResponse({ error: 'AUTH', success: false, message: 'Admin only' }, 403);
  }

  var body = parseJsonBody(e.postData && e.postData.contents);
  if (!body || !body.id) {
    return createJsonResponse({ success: false, message: 'Missing user id' }, 400);
  }

  var updated = updateUser(body.id, {
    name: body.name,
    role: body.role,
    is_active: body.is_active
  });

  if (!updated) {
    return createJsonResponse({ success: false, message: 'User not found' }, 404);
  }

  return createJsonResponse({ success: true, user: updated });
}

function handleUsersResetPassword(currentUser, e) {
  if (!isAdmin(currentUser)) {
    return createJsonResponse({ error: 'AUTH', success: false, message: 'Admin only' }, 403);
  }

  var body = parseJsonBody(e.postData && e.postData.contents);
  if (!body || !body.id) {
    return createJsonResponse({ success: false, message: 'Missing user id' }, 400);
  }

  var reset = resetUserPassword(body.id);
  if (!reset) {
    return createJsonResponse({ success: false, message: 'User not found' }, 404);
  }

  return createJsonResponse({ success: true, user: reset.user, tempPassword: reset.tempPassword });
}

function handleUsersCreateGet(currentUser, e) {
  var params = (e && e.parameter) || {};
  var email = params.email ? String(params.email).trim().toLowerCase() : '';
  var name = params.name ? String(params.name) : '';

  if (!email || !name) {
    return createJsonResponse({ success: false, message: 'Missing email or name' }, 400);
  }

  var role = params.role ? String(params.role) : 'user';
  var isActive = true;
  if (params.is_active !== undefined) {
    var flag = String(params.is_active).toLowerCase();
    isActive = flag === 'true' || flag === '1' || flag === 'yes';
  }

  var created = createUser(email, name, role, isActive);
  return createJsonResponse({ success: true, user: created.user, tempPassword: created.tempPassword });
}

function handleUsersSetActiveGet(currentUser, e) {
  var params = (e && e.parameter) || {};
  var userId = params.id ? String(params.id) : '';
  if (!userId) {
    return createJsonResponse({ success: false, message: 'Missing user id' }, 400);
  }

  var isActive = true;
  if (params.is_active !== undefined) {
    var normalized = String(params.is_active).toLowerCase();
    isActive = normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  var updated = updateUser(userId, { is_active: isActive });
  if (!updated) {
    return createJsonResponse({ success: false, message: 'User not found' }, 404);
  }

  return createJsonResponse({ success: true, user: updated });
}

function handleUsersSetPasswordGet(currentUser, e) {
  var params = (e && e.parameter) || {};
  var payloadSet = {
    id: (params && params.id) ? String(params.id).trim() : '',
    email: (params && params.email) ? String(params.email).trim() : '',
    newPassword: (params && params.newPassword) ? String(params.newPassword) : ''
  };

  try {
    var updated = adminSetUserPassword_(payloadSet, currentUser);
    return createJsonResponse({
      success: true,
      user: updated
    });
  } catch (err) {
    return createJsonResponse({
      success: false,
      error: 'USERS_SET_PASSWORD_ERROR',
      message: String(err)
    });
  }
}

function handleUsersResetPasswordGet(currentUser, e) {
  var params = (e && e.parameter) || {};
  var userId = params.id ? String(params.id) : '';

  if (!userId && params.email) {
    var user = findUserByEmail(String(params.email).trim().toLowerCase());
    userId = user ? user.id : '';
  }

  if (!userId) {
    return createJsonResponse({ success: false, message: 'Missing user id' }, 400);
  }

  var reset = resetUserPassword(userId);
  if (!reset) {
    return createJsonResponse({ success: false, message: 'User not found' }, 404);
  }

  return createJsonResponse({ success: true, user: reset.user, tempPassword: reset.tempPassword });
}

function createJsonResponse(obj, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  if (statusCode) {
    output.setHeader('Status', String(statusCode));
  }
  return output;
}

function parseJsonBody(contents) {
  if (!contents) return null;
  try {
    return JSON.parse(contents);
  } catch (err) {
    return null;
  }
}

// Utility to output any sheet as JSON
function outputSheetAsJson_(sheetName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error('Sheet "' + sheetName + '" not found');
    }

    var values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return createJsonResponse({ ok: true, sheet: sheetName, rows: [] });
    }

    var headers = values[0];
    var dataRows = values.slice(1);
    var rows = [];

    for (var i = 0; i < dataRows.length; i++) {
      var r = dataRows[i];
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = r[j];
      }
      rows.push(obj);
    }

    return createJsonResponse({ ok: true, sheet: sheetName, rows: rows });

  } catch (err) {
    return createJsonResponse({ ok: false, sheet: sheetName, error: err.message });
  }
}
