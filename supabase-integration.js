/**
 * ============================================================
 * KIVUPASS — Backend Integration Layer
 * Remplace toutes les fonctions localStorage du frontend
 * par des appels Supabase.
 *
 * UTILISATION :
 *   1. Ajoutez dans <head> :
 *      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   2. Remplacez ce fichier par un <script> avant le </body>
 *      (ou importez en tant que module)
 * ============================================================
 */

// ── CONFIG ─────────────────────────────────────────────────
const SUPABASE_URL = 'https://zsuwapimhaxjyykbnmkm.supabase.co';
const SUPABASE_ANON_KEY = 'VOTRE_ANON_KEY_ICI'; // Remplacez par votre clé dans Supabase > Settings > API

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── ÉTAT GLOBAL ────────────────────────────────────────────
let CU = null;  // Current User (profil complet)

// ============================================================
// AUTH
// ============================================================

/**
 * Inscription d'un nouvel utilisateur
 */
async function handleRegister() {
  const name  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const pwd   = document.getElementById('reg-password').value;
  const role  = document.getElementById('reg-role').value;

  if (!name || !email || !pwd) { toast('Champs obligatoires manquants', 'error'); return; }

  const { data, error } = await sb.auth.signUp({
    email,
    password: pwd,
    options: {
      data: { name, phone, role }
    }
  });

  if (error) { toast(error.message, 'error'); return; }

  toast('Compte créé ! Vérifiez votre email pour activer votre compte.', 'success');
  switchTab('login');
}

/**
 * Connexion utilisateur standard
 */
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-password').value;

  if (!email || !pwd) { toast('Veuillez remplir tous les champs', 'error'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });

  if (error) { toast('Identifiants incorrects', 'error'); return; }

  const profile = await fetchCurrentUser(data.user.id);
  loginSuccess(profile);
}

/**
 * Connexion Google OAuth
 */
async function handleGoogleLogin() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if (error) toast(error.message, 'error');
}

/**
 * Connexion Owner (vérifie le PIN en plus)
 */
async function handleOwnerLogin() {
  const email = document.getElementById('owner-email').value.trim();
  const pwd   = document.getElementById('owner-password').value;
  const pin   = document.getElementById('owner-pin').value.trim();

  if (!email || !pwd || !pin) { toast('Tous les champs sont requis', 'error'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });
  if (error) { toast('Identifiants incorrects', 'error'); return; }

  // Vérification du rôle
  const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single();
  if (!profile || profile.role !== 'owner') {
    await sb.auth.signOut();
    toast('Accès non autorisé', 'error');
    return;
  }

  // Vérification PIN côté Supabase Vault ou edge function
  // Pour l'instant, on vérifie localement (à déplacer dans une Edge Function)
  const { data: pinSetting } = await sb.from('settings').select('value').eq('key', 'owner_pin').single();
  if (pinSetting && pinSetting.value !== pin) {
    await sb.auth.signOut();
    toast('Code de vérification incorrect', 'error');
    return;
  }

  loginSuccess(profile);
}

/**
 * Déconnexion
 */
async function handleLogout() {
  await sb.auth.signOut();
  CU = null;

  document.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
    else el.value = '';
  });

  document.getElementById('main-app').classList.remove('visible');
  document.getElementById('auth-screen').style.display = '';
  toast('À bientôt !', 'success');
}

/**
 * Récupérer le profil complet depuis Supabase
 */
async function fetchCurrentUser(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

/**
 * Restaurer la session existante au chargement
 */
async function restoreSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const profile = await fetchCurrentUser(session.user.id);
    if (profile) loginSuccess(profile);
  }
}

// ============================================================
// EVENTS
// ============================================================

/**
 * Récupérer tous les événements publiés
 */
async function getEvents() {
  const { data, error } = await sb
    .from('events')
    .select(`
      *,
      organizer:profiles!organizer_id(name, phone)
    `)
    .eq('status', 'published')
    .order('date', { ascending: true });

  if (error) { console.error('getEvents:', error); return []; }
  return data || [];
}

/**
 * Récupérer les événements d'un organisateur
 */
async function getOrganizerEvents(organizerId) {
  const { data, error } = await sb
    .from('events')
    .select('*')
    .eq('organizer_id', organizerId)
    .order('created_at', { ascending: false });

  if (error) { console.error('getOrganizerEvents:', error); return []; }
  return data || [];
}

/**
 * Créer un événement
 */
async function createEvent(eventData) {
  if (!CU) { toast('Connexion requise', 'error'); return null; }

  const { data, error } = await sb
    .from('events')
    .insert({
      title:            eventData.title,
      category:         eventData.category,
      address:          eventData.address,
      date:             eventData.date,
      time:             eventData.time,
      price:            parseFloat(eventData.price),
      currency:         eventData.currency,
      capacity:         parseInt(eventData.capacity),
      description:      eventData.description,
      image_url:        eventData.imageUrl || null,
      organizer_id:     CU.id,
      organizer_name:   CU.name,
      payment_phone:    eventData.paymentPhone,
      payment_name:     eventData.paymentName,
      payment_operator: eventData.paymentOperator,
      status:           'pending'  // En attente d'approbation par owner
    })
    .select()
    .single();

  if (error) { toast('Erreur création événement : ' + error.message, 'error'); return null; }

  // Upload image si base64 fournie
  if (eventData.imageBase64) {
    await uploadEventImage(data.id, eventData.imageBase64);
  }

  toast('Événement créé ! En attente de publication.', 'success');
  return data;
}

/**
 * Uploader l'image d'un événement vers Supabase Storage
 */
async function uploadEventImage(eventId, base64Data) {
  // Convertir base64 en Blob
  const res = await fetch(base64Data);
  const blob = await res.blob();
  const ext  = blob.type.split('/')[1] || 'jpg';
  const path = `${eventId}/cover.${ext}`;

  const { data, error } = await sb.storage
    .from('event-images')
    .upload(path, blob, { upsert: true, contentType: blob.type });

  if (error) { console.error('uploadEventImage:', error); return null; }

  const { data: urlData } = sb.storage.from('event-images').getPublicUrl(path);

  // Mettre à jour l'URL dans la table events
  await sb.from('events').update({ image_url: urlData.publicUrl }).eq('id', eventId);
  return urlData.publicUrl;
}

/**
 * Publier / dépublier un événement (owner)
 */
async function setEventStatus(eventId, status) {
  const { error } = await sb.from('events').update({ status }).eq('id', eventId);
  if (error) { toast('Erreur : ' + error.message, 'error'); return false; }
  toast(`Événement ${status === 'published' ? 'publié' : 'dépublié'} !`, 'success');
  return true;
}

/**
 * Supprimer un événement (owner)
 */
async function deleteEvent(eventId) {
  const { error } = await sb.from('events').delete().eq('id', eventId);
  if (error) { toast('Erreur suppression : ' + error.message, 'error'); return false; }
  toast('Événement supprimé', 'success');
  return true;
}

// ============================================================
// TICKETS
// ============================================================

/**
 * Récupérer les tickets de l'utilisateur courant
 */
async function getMyTickets() {
  if (!CU) return [];
  const { data, error } = await sb
    .from('tickets')
    .select('*')
    .eq('owner_id', CU.id)
    .order('purchased_at', { ascending: false });

  if (error) { console.error('getMyTickets:', error); return []; }
  return data || [];
}

/**
 * Récupérer tous les tickets (admin)
 */
async function getAllTickets(statusFilter = null) {
  let query = sb.from('tickets').select('*').order('purchased_at', { ascending: false });
  if (statusFilter) query = query.eq('payment_status', statusFilter);
  const { data, error } = await query;
  if (error) { console.error('getAllTickets:', error); return []; }
  return data || [];
}

/**
 * Récupérer les tickets d'un organisateur
 */
async function getOrganizerTickets(organizerId) {
  const { data, error } = await sb
    .from('tickets')
    .select('*')
    .eq('organizer_id', organizerId)
    .order('purchased_at', { ascending: false });
  if (error) { console.error('getOrganizerTickets:', error); return []; }
  return data || [];
}

/**
 * Soumettre une demande d'achat de billet
 */
async function processPayment() {
  const phone    = document.getElementById('pay-phone').value.trim();
  const email    = document.getElementById('pay-email').value.trim();
  const txid     = document.getElementById('pay-txid').value.trim();
  const proofImg = document.getElementById('proof-preview-img');
  const proofData = proofImg && proofImg.style.display !== 'none' ? proofImg.src : null;

  if (!phone)     { toast('Entrez votre numéro d\'envoi', 'error'); return; }
  if (!txid)      { toast('Entrez l\'ID de transaction', 'error'); return; }
  if (!proofData) { toast('Ajoutez une photo de preuve de paiement', 'error'); return; }
  if (!chosenMethod) { toast('Sélectionnez votre opérateur', 'error'); return; }
  if (!pendingEvent) { toast('Aucun événement sélectionné', 'error'); return; }

  const btn = document.getElementById('pay-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Envoi de la demande…';

  try {
    // Générer un ID unique côté client (sera validé côté DB)
    const ticketId = 'GE-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Uploader la preuve de paiement vers Supabase Storage
    let proofUrl = proofData; // Fallback base64
    try {
      const res  = await fetch(proofData);
      const blob = await res.blob();
      const path = `${CU.id}/${ticketId}.jpg`;
      const { data: upData } = await sb.storage
        .from('payment-proofs')
        .upload(path, blob, { contentType: 'image/jpeg' });

      if (upData) {
        const { data: urlData } = await sb.storage
          .from('payment-proofs')
          .createSignedUrl(path, 60 * 60 * 24 * 30); // 30 jours
        proofUrl = urlData?.signedUrl || proofData;
      }
    } catch (uploadErr) {
      console.warn('Upload Storage échoué, fallback base64:', uploadErr);
    }

    // Insérer le ticket
    const { data: ticket, error } = await sb.from('tickets').insert({
      id:               ticketId,
      event_id:         pendingEvent.id,
      event_title:      pendingEvent.title,
      event_date:       pendingEvent.date,
      event_time:       pendingEvent.time,
      event_address:    pendingEvent.address,
      price:            pendingEvent.price,
      currency:         pendingEvent.currency,
      organizer_id:     pendingEvent.organizer_id,
      organizer_name:   pendingEvent.organizer_name || pendingEvent.organizer,
      owner_id:         CU.id,
      owner_name:       CU.name,
      owner_email:      email,
      owner_phone:      phone,
      payment_method:   chosenMethod,
      payment_phone:    phone,
      tx_ref:           txid.toUpperCase().replace(/\s/g, ''),
      proof_image_url:  proofUrl,
      payment_status:   'pending',
    }).select().single();

    if (error) throw error;

    // Message système à l'admin
    await sendMessage('owner_admin',
      `🎫 Nouvelle demande de billet\n\nÉvénement : ${ticket.event_title}\nAcheteur : ${ticket.owner_name} (${ticket.owner_email})\nMontant : ${ticket.price} ${ticket.currency}\nOpérateur : ${chosenMethod}\nRéf TX : ${ticket.tx_ref}\n\nID billet : ${ticket.id}`,
      true
    );

    // Remplir le récap Step 3
    const mNames = { airtel:'Airtel Money', orange:'Orange Money', vodacom:'Vodacom', africel:'Africel' };
    document.getElementById('pending-ev-title').textContent = ticket.event_title;
    document.getElementById('pending-ev-meta').textContent  = `📅 ${ticket.event_date} · 📍 ${ticket.event_address}`;
    document.getElementById('pending-buyer-name').textContent = `👤 ${ticket.owner_name} · 📱 ${mNames[chosenMethod]}`;
    document.getElementById('pending-tx-ref').textContent   = `Réf: ${ticket.tx_ref}`;
    document.getElementById('pending-email').textContent    = email;
    setPayStep(3);

    toast('Demande envoyée ! En attente de confirmation.', 'success');
  } catch (err) {
    console.error('processPayment:', err);
    toast('Erreur lors de l\'envoi : ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📨 Soumettre ma demande';
  }
}

/**
 * Approuver un ticket (owner) — via RPC sécurisée
 */
async function approveTicket(ticketId) {
  const { data, error } = await sb.rpc('approve_ticket', { ticket_id: ticketId });
  if (error || !data.success) {
    toast('Erreur : ' + (data?.error || error?.message), 'error'); return false;
  }
  toast('✅ Billet approuvé !', 'success');
  renderAdminPanel();
  return true;
}

/**
 * Rejeter un ticket (owner)
 */
async function rejectTicket(ticketId) {
  const { data, error } = await sb.rpc('reject_ticket', { ticket_id: ticketId });
  if (error || !data.success) {
    toast('Erreur : ' + (data?.error || error?.message), 'error'); return false;
  }
  toast('❌ Billet rejeté', 'warning');
  renderAdminPanel();
  return true;
}

/**
 * Confirmer un reversal (owner)
 */
async function confirmReversal() {
  const txid = document.getElementById('rev-txid').value.trim();
  if (!txid) { toast('Entrez la référence de votre virement', 'error'); return; }
  if (!_reversalTicket) return;

  const { data, error } = await sb.rpc('confirm_reversal', {
    ticket_id: _reversalTicket.id,
    tx_ref: txid
  });

  if (error || !data.success) {
    toast('Erreur : ' + (data?.error || error?.message), 'error'); return;
  }

  closeModal('reversal-modal-overlay');
  toast(`✅ Virement confirmé — ${data.reversal_amount} ${_reversalTicket.currency} viré. Réf: ${data.tx_ref}`, 'success');
  renderAdminPanel();
}

/**
 * Valider un billet à l'entrée (scan QR)
 */
async function validateTicketEntry(ticketId) {
  const { data, error } = await sb.rpc('validate_ticket_entry', {
    ticket_id: ticketId,
    scanner_id: CU?.id || null
  });

  if (error) { return { valid: false, error: error.message }; }
  return data;
}

// ============================================================
// MESSAGERIE
// ============================================================

/**
 * Récupérer les conversations
 */
async function getMessages(otherUserId) {
  const myId = CU.role === 'owner' ? 'owner_admin' : CU.id;

  const { data, error } = await sb
    .from('messages')
    .select('*')
    .or(`and(from_id.eq.${myId},to_id.eq.${otherUserId}),and(from_id.eq.${otherUserId},to_id.eq.${myId})`)
    .order('sent_at', { ascending: true });

  if (error) { console.error('getMessages:', error); return []; }
  return data || [];
}

/**
 * Envoyer un message
 */
async function sendMessage(toId, text, isSystem = false) {
  if (!text?.trim() || !toId) return null;

  const fromId = CU?.role === 'owner' ? 'owner_admin' : CU?.id;
  if (!fromId) return null;

  const { data, error } = await sb.from('messages').insert({
    from_id:   fromId,
    to_id:     toId,
    text:      text.trim(),
    is_system: isSystem,
    read:      false
  }).select().single();

  if (error) { console.error('sendMessage:', error); return null; }
  return data;
}

/**
 * Wrapper pour le bouton "Envoyer" du chat
 */
async function sendMessageUI() {
  const input = document.getElementById('msg-input');
  const text  = input.value.trim();
  if (!text || !_activeChatUserId) {
    if (!_activeChatUserId) toast('Sélectionnez une conversation', 'warning');
    return;
  }

  const msg = await sendMessage(_activeChatUserId, text);
  if (msg) {
    input.value = '';
    await _loadChatMessages(_activeChatUserId);
    updateMsgBadge();
  }
}

/**
 * Charger les messages d'une conversation
 */
async function _loadChatMessages(userId) {
  const msgs = await getMessages(userId);
  const myId = CU.role === 'owner' ? 'owner_admin' : CU.id;

  const body = document.getElementById('msg-chat-body');
  if (!msgs.length) {
    body.innerHTML = `<div style="text-align:center;color:var(--text-dim);font-size:0.85rem;margin:auto;padding:40px 20px;opacity:0.6;">💬 Commencez la conversation…</div>`;
    return;
  }

  body.innerHTML = msgs.map(m => {
    const isMine = m.from_id === myId;
    const time   = new Date(m.sent_at).toLocaleString('fr-FR', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' });
    return `<div style="display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'};gap:3px;margin-bottom:2px;">
      <div style="max-width:78%;padding:10px 14px;border-radius:${isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};background:${isMine ? 'linear-gradient(135deg,var(--gold),var(--gold-light))' : m.is_system ? 'rgba(86,184,112,0.12)' : 'var(--dark-3)'};color:${isMine ? 'var(--dark)' : 'var(--text)'};font-size:0.85rem;line-height:1.55;white-space:pre-wrap;border:${m.is_system && !isMine ? '1px solid rgba(86,184,112,0.25)' : 'none'};">${m.text}</div>
      <div style="font-size:0.63rem;color:var(--text-dim);padding:0 4px;">${time}${m.is_system ? ' · système' : ''}</div>
    </div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;

  // Marquer comme lus
  await sb.from('messages')
    .update({ read: true })
    .eq('to_id', myId)
    .eq('from_id', userId)
    .eq('read', false);
}

/**
 * Mettre à jour le badge de messages non lus
 */
async function updateMsgBadge() {
  if (!CU) return;
  const myId = CU.role === 'owner' ? 'owner_admin' : CU.id;

  const { count } = await sb
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('to_id', myId)
    .eq('read', false);

  const badge = document.getElementById('sb-msg-badge');
  if (!badge) return;
  badge.style.display = (count || 0) > 0 ? 'inline-flex' : 'none';
  badge.textContent = count || 0;
}

// ============================================================
// SETTINGS
// ============================================================

/**
 * Récupérer le taux de change
 */
async function getExchangeRate() {
  const { data } = await sb.from('settings').select('value').eq('key', 'exchange_rate_usd_cdf').single();
  return data ? parseFloat(data.value) : 2800;
}

/**
 * Mettre à jour le taux de change (owner)
 */
async function updateExchangeRate() {
  const input = document.getElementById('adm-new-rate-input');
  const newRate = parseFloat(input.value);

  const { data, error } = await sb.rpc('update_exchange_rate', { new_rate: newRate });
  if (error || !data.success) {
    toast(data?.error || '⚠ Taux invalide', 'warning'); return;
  }

  input.value = '';
  toast(`✅ Taux mis à jour : ${newRate} CDF/USD`, 'success');
  renderAdminPanel();
}

// ============================================================
// ADMIN STATS
// ============================================================

/**
 * Récupérer les statistiques admin
 */
async function getAdminStats() {
  const { data, error } = await sb.from('admin_stats').select('*').single();
  if (error) { console.error('getAdminStats:', error); return null; }
  return data;
}

/**
 * Récupérer tous les utilisateurs (admin)
 */
async function getAllUsers() {
  const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
  if (error) { console.error('getAllUsers:', error); return []; }
  return data || [];
}

// ============================================================
// REALTIME SUBSCRIPTIONS
// ============================================================

/**
 * Abonner aux mises à jour en temps réel (messages, tickets)
 * À appeler après loginSuccess()
 */
function subscribeToRealtime() {
  if (!CU) return;
  const myId = CU.role === 'owner' ? 'owner_admin' : CU.id;

  // Nouveaux messages
  sb.channel('messages')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `to_id=eq.${myId}`
    }, (payload) => {
      updateMsgBadge();
      if (_activeChatUserId === payload.new.from_id) {
        _loadChatMessages(_activeChatUserId);
      }
      if (CU.role !== 'owner') {
        toast('💬 Nouveau message de Kivupass', 'success');
      }
    })
    .subscribe();

  // Changements de statut des tickets (pour les acheteurs)
  if (CU.role === 'attendee' || CU.role === 'organizer') {
    sb.channel('my-tickets')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tickets',
        filter: `owner_id=eq.${CU.id}`
      }, (payload) => {
        if (payload.new.payment_status === 'approved' && payload.old.payment_status === 'pending') {
          toast('🎉 Votre billet a été approuvé !', 'success');
          renderDashboard?.();
        }
        if (payload.new.payment_status === 'rejected') {
          toast('❌ Votre paiement n\'a pas été validé.', 'error');
        }
      })
      .subscribe();
  }

  // Notifications admin : nouveaux tickets en attente
  if (CU.role === 'owner') {
    sb.channel('admin-tickets')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'tickets'
      }, () => {
        updateAdminBadge?.();
        toast('🎫 Nouveau billet en attente', 'success');
      })
      .subscribe();
  }
}

// ============================================================
// INITIALISATION
// ============================================================

/**
 * Point d'entrée : appel au chargement de la page
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Écouter les changements d'état d'auth (OAuth redirect)
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session && !CU) {
      const profile = await fetchCurrentUser(session.user.id);
      if (profile) loginSuccess(profile);
    }
    if (event === 'SIGNED_OUT') {
      CU = null;
    }
  });

  // Restaurer session existante
  await restoreSession();
});

/**
 * loginSuccess — mise à jour UI après connexion réussie
 * (Identique à l'original mais CU vient de Supabase)
 */
function loginSuccess(user) {
  CU = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('main-app').classList.add('visible');
  updateAppUI();
  subscribeToRealtime();
  if (user.role === 'owner') { navigate('admin'); }
  else { navigate('home'); }
  toast(`Bienvenue, ${user.name.split(' ')[0]} !`, 'success');
}
