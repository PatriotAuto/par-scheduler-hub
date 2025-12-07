let leadsCache = [];

document.addEventListener('DOMContentLoaded', () => {
  const user = getStoredUser();
  if (!user || !user.token) {
    if (typeof redirectToLogin === 'function') {
      redirectToLogin();
    } else {
      window.location.href = 'login.html';
    }
    return;
  }

  const token = user.token;
  const form = document.getElementById('lead-form');
  const resetBtn = document.getElementById('lead-reset-btn');
  const statusFilter = document.getElementById('leads-status-filter');
  const leadsTbody = document.getElementById('leads-tbody');

  if (form) {
    form.addEventListener('submit', (e) => handleLeadSubmit(e, token));
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => resetForm());
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', () => loadLeads(token));
  }

  if (leadsTbody) {
    leadsTbody.addEventListener('click', onLeadsTableClick);
  }

  loadLeads(token);
});

async function loadLeads(token) {
  const statusFilter = document.getElementById('leads-status-filter');
  const filterVal = statusFilter ? statusFilter.value : '';

  try {
    const res = await apiGet({
      action: 'leads.list',
      token: token
    });

    if (!res || res.success === false) {
      console.error('Failed to load leads', res);
      renderLeads([]);
      return;
    }

    leadsCache = res.leads || [];
    let leads = leadsCache;

    if (filterVal) {
      leads = leads.filter((l) => (l.status || '') === filterVal);
    }

    renderLeads(leads);
  } catch (err) {
    console.error('Error loading leads', err);
    renderLeads([]);
  }
}

function renderLeads(leads) {
  const tbody = document.getElementById('leads-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  leads.forEach((lead) => {
    const tr = document.createElement('tr');

    const lastContact = lead.lastContactAt || '';
    const contactDisplay = lead.contactName || '';
    const serviceDisplay = lead.serviceInterest || '';

    tr.innerHTML = `
      <td>${escapeHtml(contactDisplay)}</td>
      <td>${escapeHtml(lead.phone || '')}</td>
      <td>${escapeHtml(lead.source || '')}</td>
      <td>${escapeHtml(lead.status || '')}</td>
      <td>${escapeHtml(serviceDisplay)}</td>
      <td>${escapeHtml(lead.assignedTo || '')}</td>
      <td>${escapeHtml(lastContact)}</td>
      <td>
        <button class="table-btn" data-action="edit" data-id="${lead.id}">Edit</button>
        <button class="table-btn danger" data-action="delete" data-id="${lead.id}">Delete</button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function onLeadsTableClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');
  if (!id) return;

  if (action === 'edit') {
    startEditLead(id);
  } else if (action === 'delete') {
    confirmDeleteLead(id);
  }
}

function fillFormFromLead(lead) {
  document.getElementById('lead-id').value = lead.id || '';
  document.getElementById('lead-contactName').value = lead.contactName || '';
  document.getElementById('lead-phone').value = lead.phone || '';
  document.getElementById('lead-email').value = lead.email || '';
  document.getElementById('lead-source').value = lead.source || '';
  document.getElementById('lead-status').value = lead.status || 'New';
  document.getElementById('lead-vehicleYear').value = lead.vehicleYear || '';
  document.getElementById('lead-vehicleMake').value = lead.vehicleMake || '';
  document.getElementById('lead-vehicleModel').value = lead.vehicleModel || '';
  document.getElementById('lead-serviceInterest').value = lead.serviceInterest || '';
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
  document.getElementById('lead-status').value = 'New';
  document.getElementById('lead-vehicleYear').value = '';
  document.getElementById('lead-vehicleMake').value = '';
  document.getElementById('lead-vehicleModel').value = '';
  document.getElementById('lead-serviceInterest').value = '';
  document.getElementById('lead-budget').value = '';
  document.getElementById('lead-notes').value = '';
  document.getElementById('lead-form-title').textContent = 'New Lead';
}

async function handleLeadSubmit(e, token) {
  e.preventDefault();

  const id = document.getElementById('lead-id').value || null;
  const contactName = document.getElementById('lead-contactName').value.trim();
  const phone = document.getElementById('lead-phone').value.trim();
  const email = document.getElementById('lead-email').value.trim();
  const source = document.getElementById('lead-source').value.trim();
  const status = document.getElementById('lead-status').value;
  const vehicleYear = document.getElementById('lead-vehicleYear').value.trim();
  const vehicleMake = document.getElementById('lead-vehicleMake').value.trim();
  const vehicleModel = document.getElementById('lead-vehicleModel').value.trim();
  const serviceInterest = document.getElementById('lead-serviceInterest').value.trim();
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
    loadLeads(token);
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

  const user = getStoredUser();
  if (!user || !user.token) return;

  apiGet({ action: 'leads.list', token: user.token })
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

  const user = getStoredUser();
  if (!user || !user.token) return;

  apiGet({
    action: 'leads.delete',
    token: user.token,
    id: id
  })
    .then((res) => {
      if (!res || res.success === false) {
        console.error('Failed to delete lead', res);
        alert('Failed to delete lead.');
        return;
      }
      loadLeads(user.token);
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
