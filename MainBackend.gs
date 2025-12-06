/**
 * MainBackend.gs - API entrypoint for Patriot Scheduler
 * Adds user management endpoints and dispatch for GET/POST actions.
 */

function doGet(e) {
  return handleRequest('GET', e || {});
}

function doPost(e) {
  return handleRequest('POST', e || {});
}

function handleRequest(method, e) {
  var action = (e.parameter && e.parameter.action) || '';
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
  var session = requireAuth_(e);
  if (session && session.errorResponse) return session.errorResponse;
  var authedUser = session.user;

  // Dispatch
  if (action === 'users.list') return handleUsersList(authedUser);
  if (action === 'users.create' && method === 'POST') return handleUsersCreate(authedUser, e);
  if (action === 'users.update' && method === 'POST') return handleUsersUpdate(authedUser, e);
  if (action === 'users.resetPassword' && method === 'POST') return handleUsersResetPassword(authedUser, e);

  return createJsonResponse({ success: false, message: 'Unknown action' }, 404);
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
