let leadsCache = [];
let authToken = null;
let vehicleDropdownsReady = null;
let vehicleDropdownsController = null;

document.addEventListener('DOMContentLoaded', () => {
  authToken = typeof getStoredToken === 'function' ? getStoredToken() : null;

  if (!authToken) {
    window.location.href = 'login.html';
    return;
  }

  const form = document.getElementById('lead-form');
  const resetBtn = document.getElementById('lead-reset-btn');
  const statusFilter = document.getElementById('leads-status-filter');

  vehicleDropdownsReady = initVehicleDropdowns();
  vehicleDropdownsReady.then((controller) => {
    vehicleDropdownsController = controller;
  });

  if (form) {
    form.addEventListener('submit', (e) => handleLeadSubmit(e));
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => resetForm());
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', () => loadLeads());
  }

  loadLeads();
});

function formatPhoneDisplay(phone) {
  if (!phone) return '';
  var digits = String(phone).replace(/\D+/g, '');
  if (!digits) return '';

  if (digits.length === 11 && digits.charAt(0) === '1') {
    var cc = digits.charAt(0);
    var area = digits.substr(1, 3);
    var mid = digits.substr(4, 3);
    var last = digits.substr(7, 4);
    return cc + '-(' + area + ')-' + mid + '-' + last;
  }

  if (digits.length >= 10) {
    digits = digits.substr(digits.length - 10);
    var area2 = digits.substr(0, 3);
    var mid2 = digits.substr(3, 3);
    var last2 = digits.substr(6, 4);
    return '(' + area2 + ')-' + mid2 + '-' + last2;
  }

  return digits;
}

async function loadLeads() {
  const statusFilter = document.getElementById('leads-status-filter');
  const filterVal = statusFilter ? statusFilter.value : '';

  try {
    const res = await apiGet({
      action: 'leads.list'
    });

    if (!res || res.success === false) {
      console.error('Failed to load leads', res);
      renderLeadsTable([]);
      return;
    }

    leadsCache = res.leads || [];
    let leads = leadsCache;

    if (filterVal) {
      leads = leads.filter((l) => (l.status || '') === filterVal);
    }

    renderLeadsTable(leads);
  } catch (err) {
    console.error('Error loading leads', err);
    renderLeadsTable([]);
  }
}

function renderLeadsTable(leads) {
  var tbody = document.querySelector('#leadsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!leads || !leads.length) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'No leads found.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  leads.forEach(function(lead) {
    var tr = document.createElement('tr');

    var tdService = document.createElement('td');
    tdService.textContent = (lead.serviceInterest || '').toString();
    tr.appendChild(tdService);

    var name = (lead.contactName || '').toString().trim();
    if (name.toLowerCase().indexOf('sales - ') === 0) {
      name = name.substr(8).trim();
    }
    var tdContact = document.createElement('td');
    tdContact.textContent = name || '(no name)';
    tr.appendChild(tdContact);

    var tdPhone = document.createElement('td');
    tdPhone.textContent = formatPhoneDisplay(lead.phone || '');
    tr.appendChild(tdPhone);

    var tdSource = document.createElement('td');
    tdSource.textContent = lead.source || '';
    tr.appendChild(tdSource);

    var tdStatus = document.createElement('td');
    tdStatus.textContent = lead.status || '';
    tr.appendChild(tdStatus);

    var tdActions = document.createElement('td');
    tdActions.className = 'actions-cell';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.className = 'table-btn';
    editBtn.addEventListener('click', function() {
      startEditLead(lead.id);
    });
    tdActions.appendChild(editBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'table-btn danger';
    deleteBtn.style.marginLeft = '4px';
    deleteBtn.addEventListener('click', function() {
      confirmDeleteLead(lead.id);
    });
    tdActions.appendChild(deleteBtn);

    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

function fillFormFromLead(lead) {
  document.getElementById('lead-id').value = lead.id || '';
  document.getElementById('lead-contactName').value = lead.contactName || '';
  document.getElementById('lead-phone').value = lead.phone || '';
  document.getElementById('lead-email').value = lead.email || '';
  document.getElementById('lead-source').value = lead.source || '';
  document.getElementById('leadStatus').value = lead.status || '';
  setVehicleDropdownValues(lead.vehicleYear, lead.vehicleMake, lead.vehicleModel);
  document.getElementById('leadServiceInterest').value = lead.serviceInterest || '';
  document.getElementById('lead-budget').value = lead.budget || '';
  document.getElementById('lead-notes').value = lead.notes || '';
  document.getElementById('lead-form-title').textContent = 'Edit Lead';
}

function resetForm() {
  document.getElementById('lead-id').value = '';
  document.getElementById('lead-contactName').value = '';
  document.getElementById('lead-phone').value = '';
  document.getElementById('lead-email').value = '';
  document.getElementById('lead-source').value = '';
  document.getElementById('leadStatus').value = 'New Lead';
  setVehicleDropdownValues('', '', '');
  document.getElementById('leadServiceInterest').value = '';
  document.getElementById('lead-budget').value = '';
  document.getElementById('lead-notes').value = '';
  document.getElementById('lead-form-title').textContent = 'New Lead';
}

async function setVehicleDropdownValues(year, make, model) {
  if (!vehicleDropdownsReady) return;
  const controller = await vehicleDropdownsReady;
  if (controller && typeof controller.setValues === 'function') {
    controller.setValues({ year, make, model });
  }
}

async function handleLeadSubmit(e) {
  e.preventDefault();

  const token = authToken || (typeof getStoredToken === 'function' ? getStoredToken() : null);
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  const id = document.getElementById('lead-id').value || null;
  const contactName = document.getElementById('lead-contactName').value.trim();
  const phone = document.getElementById('lead-phone').value.trim();
  const email = document.getElementById('lead-email').value.trim();
  const source = document.getElementById('lead-source').value.trim();
  const status = document.getElementById('leadStatus').value || 'New Lead';
  const vehicleYear = document.getElementById('vehicleYearSelect').value.trim();
  const vehicleMake = document.getElementById('vehicleMakeSelect').value.trim();
  const vehicleModel = document.getElementById('vehicleModelSelect').value.trim();
  const serviceInterest = document.getElementById('leadServiceInterest').value.trim();
  const budget = document.getElementById('lead-budget').value.trim();
  const notes = document.getElementById('lead-notes').value.trim();

  if (!contactName || (!phone && !email)) {
    alert('Contact name and at least phone or email are required.');
    return;
  }

  const payload = {
    id,
    contactName,
    phone,
    email,
    source,
    status,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    serviceInterest,
    budget,
    notes
  };

  try {
    const res = await apiGet({
      action: 'leads.save',
      token: token,
      payload: JSON.stringify(payload)
    });

    if (!res || res.success === false) {
      console.error('Failed to save lead', res);
      alert('Failed to save lead.');
      return;
    }

    resetForm();
    loadLeads();
  } catch (err) {
    console.error('Error saving lead', err);
    alert('Error saving lead.');
  }
}

function startEditLead(id) {
  const cached = leadsCache.find((l) => String(l.id) === String(id));
  if (cached) {
    fillFormFromLead(cached);
    return;
  }

  const token = authToken || (typeof getStoredToken === 'function' ? getStoredToken() : null);
  if (!token) return;

  apiGet({ action: 'leads.list', token: token })
    .then((res) => {
      if (!res || res.success === false) return;
      const leads = res.leads || [];
      const lead = leads.find((l) => String(l.id) === String(id));
      if (lead) {
        fillFormFromLead(lead);
      }
    })
    .catch((err) => console.error('Error loading single lead', err));
}

function confirmDeleteLead(id) {
  if (!confirm('Delete this lead?')) return;

  const token = authToken || (typeof getStoredToken === 'function' ? getStoredToken() : null);
  if (!token) return;

  apiGet({
    action: 'leads.delete',
    token: token,
    id: id
  })
    .then((res) => {
      if (!res || res.success === false) {
        console.error('Failed to delete lead', res);
        alert('Failed to delete lead.');
        return;
      }
      loadLeads();
    })
    .catch((err) => {
      console.error('Error deleting lead', err);
      alert('Error deleting lead.');
    });
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
