let currentProjectId = null;
let allLeads = []; // Holds all fetched data
let filteredLeads = []; // Holds search/filtered results
let currentPage = 1;
const itemsPerPage = 8; // Increased from 3-4 to 8 for better density
let currentTab = 'enquiries';
Chart.register(ChartZoom);
		async function initializeAuth() {
			const loader = document.getElementById('loader');
			const { data: { user }, error: authError } = await sb.auth.getUser();

			if (authError || !user) {
				window.location.href = 'index.html';
				return;
			}
			
			const initialSessionId = user.id;
			
			// 2. Watch for session changes (Collision Detection)
			sb.auth.onAuthStateChange((event, session) => {
				if (event === 'SIGNED_OUT' || !session) {
					window.location.href = 'index.html';
				} else if (session.user.id !== initialSessionId) {
					// Identity Theft Detection: If the ID in storage changed to User B, kill this tab
					alert("Security: Another user has logged in. Closing session.");
					window.location.href = 'index.html';
				}
			});
			
			// 3. ADD THIS: Server-Side Expiry Check (The "Laptop Sleep" Fix)
			const { data: sessionData, error: sessionError } = await sb
				.from('user_sessions')
				.select('expires_at')
				.eq('user_id', user.id)
				.single();

			if (sessionError || !sessionData) {
				console.error("No server session record found.");
				handleLogout();
				return;
			}

			const now = new Date();
			const expiryTime = new Date(sessionData.expires_at);

			if (now > expiryTime) {
				//alert("Session Expired. Please login again.");
				showExpiryPopup();
				//handleLogout();
				return;
			}

			// 4. Background Heartbeat (Optional but recommended)
			// Checks every 2 minutes if the session was killed while the tab was open
			setInterval(async () => {
				const { data } = await sb.from('user_sessions').select('expires_at').eq('user_id', user.id).single();
				if (data && new Date() > new Date(data.expires_at)) {
					handleLogout();
				}
			}, 120000);
			
			window.userSession = {
				id: user.id,
				email: user.email
			};
			
			try {
				const { data: profile, error: profileError } = await sb
					.from('profiles')
					.select('is_admin, email')
					.eq('id', user.id)
					.single();

				if (profileError || !profile) {
					await sb.auth.signOut();
					window.location.href = 'index.html';
					return;
				}
				
				window.currentUserProfile = profile
				
				if (profile.is_admin) {
					document.getElementById('tab-users')?.classList.remove('hidden');
				}

				if (loader) loader.classList.add('hidden');

				if (profile.is_admin) {
					document.getElementById('admin-view').classList.remove('hidden');
					document.getElementById('admin-project-actions')?.classList.remove('hidden');
					fetchAdminData();
				} else {
					document.getElementById('client-view').classList.remove('hidden');
					initializeClientDashboard(profile.email);
				}
			} catch (err) {
				window.location.href = 'index.html';
			}
		}

		initializeAuth();

		sb.auth.onAuthStateChange((event) => {
			if (event === 'SIGNED_OUT') window.location.href = 'index.html';
		});
		
		async function fetchAdminData() {
			if (currentTab === 'projects') {
				loadAdminProjects();
				return;
			}

			const container = document.getElementById('admin-content');
			container.innerHTML = `<div class="p-20 text-center animate-pulse text-slate-400 font-bold text-[10px] uppercase tracking-widest">Syncing Pipeline...</div>`;
			
			const isQuoteFilter = currentTab === 'quotes';
			const [rawRes, custRes, detRes, statRes] = await Promise.all([
				sb.from('raw_enquiries').select('*').eq('is_quote', isQuoteFilter),
				sb.from('customer_details').select('*'),
				sb.from('enquiry_details').select('*'),
				sb.from('enquiry_status').select('*')
			]);

			if (rawRes.error) { container.innerHTML = "Error loading data"; return; }

			// Map all data into the global allLeads array
			allLeads = rawRes.data.map(lead => ({
				...lead,
				customer: custRes.data?.find(c => c.enquiry_id === lead.id) || {},
				detail: detRes.data?.find(d => d.enquiry_id === lead.id) || {},
				statusLabel: statRes.data?.find(s => s.status_id === (detRes.data?.find(d => d.enquiry_id === lead.id)?.status_id))?.status_details || 'New'
			}));

			allLeads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
			filteredLeads = [...allLeads]; // CRITICAL: Initialize this so renderTable works
			renderTable(); 
		}
		
		// Function to show the custom popup
		function showExpiryPopup() {
			const modal = document.getElementById('expiry-modal');
			const content = document.getElementById('expiry-content');
			const loader = document.getElementById('loader');
			const portal = document.getElementById('portal-container'); // Your main wrapper

			// 1. Hide the "Authenticating..." loader
			if (loader) loader.style.display = 'none';
			
			// 2. Hide the main portal content (optional, for extra security)
			if (portal) portal.classList.add('hidden');
			
			modal.classList.remove('opacity-0', 'pointer-events-none');
			content.classList.remove('scale-95');
			content.classList.add('scale-100');
			
			// Refresh icons if you are using Lucide
			if (window.lucide) lucide.createIcons();
		}

		function handleSearch() {
			searchQuery = document.getElementById('leadSearch').value.toLowerCase();
			currentPage = 1; 

			if (currentTab === 'users') {
				// Physical search for the User Management table rows
				const rows = document.querySelectorAll('#users-table-body tr');
				rows.forEach(row => {
					const rowText = row.innerText.toLowerCase();
					row.style.display = rowText.includes(searchQuery) ? '' : 'none';
				});
			} else if (currentTab === 'projects') {
				loadAdminProjects(); // Project search is server-side (Supabase)
			} else {
				// Enquiry/Quote search is client-side (Filtering local array)
				filteredLeads = allLeads.filter(lead => 
					(lead.customer?.customer_name?.toLowerCase().includes(searchQuery)) ||
					(lead.customer?.email_id?.toLowerCase().includes(searchQuery)) ||
					(lead.project_name?.toLowerCase().includes(searchQuery))
				);
				renderTable(); 
			}
		}

		function handleSort() {
			sortBy = document.getElementById('sortOrder').value;
			currentPage = 1;

			if (currentTab === 'projects') {
				loadAdminProjects();
			} else {
				// Sort the leads array based on selection
				if (sortBy === 'newest') allLeads.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
				else if (sortBy === 'oldest') allLeads.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
				
				filteredLeads = [...allLeads];
				handleSearch(); // Re-apply search filter after sorting
			}
		}

		// 5. Pagination and Table Rendering
		function renderTable() {
			const container = document.getElementById('admin-content');
			const start = (currentPage - 1) * itemsPerPage;
			const end = start + itemsPerPage;
			const paginatedItems = filteredLeads.slice(start, end);

			if (paginatedItems.length === 0) {
				container.innerHTML = `<div class="p-20 text-center text-slate-400 uppercase font-bold text-[10px] tracking-widest">No Matches Found</div>`;
				renderPagination();
				return;
			}

			container.innerHTML = paginatedItems.map(lead => `
				<div class="animate-slide-up glass-panel grid grid-cols-12 items-center p-4 px-8 rounded-2xl group hover:border-indigo-500/50 transition-all duration-300">
					<div class="col-span-4">
						<div class="flex items-center gap-4">
							<div class="w-10 h-10 rounded-xl bg-slate-900 border border-white/5 flex items-center justify-center text-white font-bold text-sm">
								${lead.customer.customer_name ? lead.customer.customer_name.charAt(0) : '?'}
							</div>
							<div>
								<h3 class="font-bold text-white text-sm tracking-tight">${lead.customer.customer_name || 'Anonymous'}</h3>
								<p class="text-[9px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">${lead.customer.email_id || lead.email_id}</p>
							</div>
						</div>
					</div>
					<div class="col-span-3">
						<span class="px-3 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[9px] font-black rounded-lg uppercase">
							${lead.statusLabel}
						</span>
					</div>
					<div class="col-span-2 flex gap-2">
						${lead.customer.is_member ? '<i data-lucide="shield-check" class="w-4 h-4 text-indigo-400"></i>' : ''}
					</div>
					<div class="col-span-3 text-right">
						<button onclick="manageLead('${lead.id}')" class="bg-white/5 hover:bg-indigo-600 border border-white/10 text-white px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all">
							Manage
						</button>
					</div>
				</div>
			`).join('');

			renderPagination();
			lucide.createIcons();
		}

		function renderPagination() {
			const pg = document.getElementById('pagination-controls');
			const totalPages = Math.ceil(filteredLeads.length / itemsPerPage);
			
			if (totalPages <= 1) { pg.innerHTML = ''; return; }

			pg.innerHTML = `
				<button onclick="changePage(-1)" ${currentPage === 1 ? 'disabled' : ''} class="p-2 text-slate-500 hover:text-white disabled:opacity-20 transition"><i data-lucide="chevron-left"></i></button>
				<span class="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Page ${currentPage} of ${totalPages}</span>
				<button onclick="changePage(1)" ${currentPage === totalPages ? 'disabled' : ''} class="p-2 text-slate-500 hover:text-white disabled:opacity-20 transition"><i data-lucide="chevron-right"></i></button>
			`;
			lucide.createIcons();
		}

		function changePage(step) {
			currentPage += step;
			renderTable();
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}

		async function manageLead(leadId) {
			const modal = document.getElementById('lead-modal');
			const content = document.getElementById('modal-body-content');
			modal.classList.remove('hidden');
			content.innerHTML = `<div class="py-20 text-center animate-pulse text-slate-400 text-[10px] font-bold uppercase tracking-widest">Initializing Workspace...</div>`;

			const [leadRes, custRes, detRes, commRes, statRes, quoteRes, imagesRes] = await Promise.all([
				sb.from('raw_enquiries').select('*').eq('id', leadId).single(),
				sb.from('customer_details').select('*').eq('enquiry_id', leadId).single(),
				sb.from('enquiry_details').select('*').eq('enquiry_id', leadId).single(),
				sb.from('enquiry_comments').select('*').eq('enquiry_id', leadId).order('created_at', { ascending: false }),
				sb.from('enquiry_status').select('*'),
				sb.from('quote_details').select('*').eq('enquiry_id', leadId).maybeSingle(),
				sb.from('quote_images').select('image_url').eq('enquiry_id', leadId)
			]);
			
			const lead = leadRes.data;
			const customer = custRes.data;
			const details = detRes.data;
			const email = customer?.email_id || lead?.email_id;
			const quote = quoteRes.data;
			const images = imagesRes.data || [];
			const currentProjectId = details.project_id
			//const { data: profile } = await sb.from('profiles').select('*').eq('email', email).single();
			//const isRegistered = !!profile;
			
			const { data: profileData, error: profileError } = await sb
				.from('profiles')
				.select('id')
				.eq('email', email);
			const isRegistered = profileData && profileData.length > 0;
			const isAdmin = window.currentUserProfile?.is_admin === true;
			
			document.getElementById('modal-title').innerText = `${customer?.customer_name || 'New Lead'} - Query`;
			document.getElementById('modal-subtitle').innerText = lead.query_data;

			content.innerHTML = `
				<div class="p-5 bg-slate-900 rounded-2xl text-white border border-white/5 flex items-center justify-between">
					<div class="flex items-center gap-4">
						<div class="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
							<i data-lucide="${isRegistered ? 'shield-check' : 'user-plus'}" class="w-5 h-5"></i>
						</div>
						<div>
							<p class="text-[8px] font-black text-indigo-400 uppercase tracking-widest leading-none mb-1">Security Status</p>
							<h4 class="text-sm font-bold">${isRegistered ? 'Verified Client' : 'External Lead'}</h4>
						</div>
					</div>
					<div class="text-right">
						<p class="text-[8px] text-white/40 font-bold uppercase tracking-widest mb-1">Linked Email</p>
						<p class="text-xs font-medium">${email}</p>
					</div>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 bg-slate-900/40 rounded-2xl border border-white/5">
					<div class="space-y-1.5">
						<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1">Customer Name</label>
						<input id="edit-name" type="text" value="${customer?.customer_name || ''}" 
						class="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs font-bold text-white outline-none focus:ring-1 focus:ring-indigo-500">
					</div>
					<div class="space-y-1.5">
						<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1">Phone Number</label>
						<input id="edit-phone" type="text" value="${customer?.phone_number || ''}" 
						class="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs font-bold text-white outline-none focus:ring-1 focus:ring-indigo-500">
					</div>
					<div class="space-y-1.5">
						<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1">Pipeline Status</label>
						${isAdmin ? `
						<select id="edit-status" class="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs font-bold text-white outline-none focus:ring-1 focus:ring-indigo-500">
							${statRes.data.map(s => `<option value="${s.status_id}" ${details?.status_id === s.status_id ? 'selected' : ''}>${s.status_details}</option>`).join('')}
						</select>
						` : `
						<div class="w-full px-4 py-2.5 bg-slate-950 border border-white/5 rounded-xl text-xs font-bold text-indigo-400">
							${statRes.data.find(s => s.status_id === details?.status_id)?.status_details || 'Under Review'}
						</div>
						`}
					</div>
				</div>
				
				${getQuoteHTML(quote, images)}

				<div class="space-y-4">
					<div class="flex items-center justify-between px-2">
						<h4 class="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Interaction History</h4>
						<div class="flex gap-2 w-2/3">
							<input id="new-comment" placeholder="Log internal note..." class="flex-1 px-4 py-2 bg-slate-900 border border-white/10 rounded-xl text-xs text-white outline-none">
							<button onclick="addComment('${leadId}')" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase hover:bg-indigo-500 transition">Post</button>
						</div>
					</div>
					
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto pr-2">
						${commRes.data?.length > 0 ? commRes.data.map(c => {
							const isAdminNote = c.org_comments !== null && c.org_comments !== '';
							const noteText = isAdminNote ? c.org_comments : c.comments;
							
							return `
								<div class="p-4 rounded-xl ${isAdminNote ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-white/5 border border-white/5'}">
									<div class="flex justify-between items-center mb-1">
										<span class="text-[8px] font-black uppercase tracking-widest ${isAdminNote ? 'text-amber-500' : 'text-indigo-400'}">
											${isAdminNote ? 'Admin Note' : 'Client Message'}
										</span>
										<span class="text-[8px] text-slate-500 font-medium">${new Date(c.created_at).toLocaleDateString()}</span>
									</div>
									<p class="text-[11px] text-slate-300 leading-snug">${noteText}</p>
								</div>
							`;
						}).join('') : '<p class="text-[10px] text-slate-500 italic col-span-2 text-center py-4">No interactions recorded.</p>'}
					</div>
				</div>
			
				${details?.is_project ? `
					<div class="mt-8 p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center justify-between">
						<div class="flex items-center gap-3">
							<div class="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
								<i data-lucide="check-circle" class="w-5 h-5"></i>
							</div>
							<div>
								<h4 class="text-xs font-black text-white uppercase tracking-tight">Active Project Linked</h4>
								<p class="text-[9px] text-emerald-300/60 font-medium">Project ID: ${details.project_id.slice(0,8)}... is live.</p>
							</div>
						</div>
						<button onclick="goToProjectFromEnquiry('${details.project_id}')" 
								class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 group">
							Go to Project Workspace
							<i data-lucide="arrow-right" class="w-3 h-3 group-hover:translate-x-1 transition-transform"></i>
						</button>
					</div>
				` : `
					<div id="onboarding-zone" class="mt-8">
						${isAdmin? `
							<div class="p-5 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-400">
										<i data-lucide="layers" class="w-5 h-5"></i>
									</div>
									<div>
										<h4 class="text-xs font-black text-white uppercase tracking-tight">Cluster Management</h4>
										<p class="text-[9px] text-indigo-300/60 font-medium">Scan for other enquiries from this client to group them.</p>
									</div>
								</div>
								<button onclick="searchSiblingsForOnboarding('${leadId}', '${email}')" 
									class="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-500/20">
									Scan for Related Items
								</button>
							</div>` : ``
							}
					</div>
				`}

				${(!isRegistered) ? `
				<div class="mt-3 px-4 py-3 bg-white/5 border border-white/5 rounded-xl flex items-center justify-between">
					<p class="text-[9px] text-slate-400 font-medium">Client hasn't joined the portal yet.</p>
					<button onclick="sendRegistrationInvite('${email}', '${customer?.customer_name}', '${leadId}')" 
						class="text-[9px] font-black text-indigo-400 uppercase tracking-widest hover:text-white transition">
						Send Invite &rarr;
					</button>
				</div>
				` : ''}
			`; // End of content.innerHTML template
			lucide.createIcons();
			document.getElementById('save-btn').onclick = () => saveLeadChanges(leadId);
		}
		
		function switchTab(tab) {
			currentTab = tab;
			
			// 1. Handle UI Highlighting
			document.querySelectorAll('[id^="tab-"]').forEach(btn => btn.classList.remove('active-tab'));
			document.getElementById(`tab-${tab}`).classList.add('active-tab');

			// 2. Handle Title and Container Visibility
			const titles = {
				'enquiries': 'Enquiry Pipeline',
				'quotes': 'Active Quotations',
				'projects': 'Project Dashboard',
				'users' : 'User Management'
			};
			document.getElementById('tab-title').innerText = titles[tab];

			const enquiriesView = document.getElementById('enquiries-view');
			const projectsView = document.getElementById('projects-view');
			const usersView = document.getElementById('users-view');
			const pipelineHeader = document.getElementById('main-pipeline-header');
			
			const sortDropdown = document.getElementById('sortOrder');
			if (sortDropdown) {
				sortDropdown.classList.toggle('hidden', tab === 'users');
			}
			
			// 4. Toggle visibility of the "Customer Identity" header
			// Only show it for enquiries and quotes
			if (pipelineHeader) {
				if (tab === 'enquiries' || tab === 'quotes') {
					pipelineHeader.classList.remove('hidden');
				} else {
					pipelineHeader.classList.add('hidden');
				}
			}
			
			// Hide all first
			enquiriesView.classList.add('hidden');
			projectsView.classList.add('hidden');
			usersView.classList.add('hidden');

			// 4. Handle Logic per Tab
			if (tab === 'projects') {
				projectsView.classList.remove('hidden');
				loadAdminProjects(); 
			} else if (tab === 'users') {
				usersView.classList.remove('hidden');
				fetchUsers();
			} else {
				// For Enquiries or Quotes
				enquiriesView.classList.remove('hidden');
				// If there's a hardcoded header row inside 'admin-content' or before it, 
				// you may need to ensure it's only visible here.
				fetchAdminData(); 
			}
		}

		async function searchSiblingsForOnboarding(primaryId, email) {
			const zone = document.getElementById('onboarding-zone');
			zone.innerHTML = `<div class="py-10 animate-pulse text-slate-400 text-[10px] font-black uppercase tracking-widest text-center">Scanning Cluster...</div>`;

			try {
				const { data: customerEntries } = await sb.from('customer_details').select('enquiry_id').eq('email_id', email);
				const allEnquiryIds = customerEntries.map(ce => ce.enquiry_id);
				const { data: siblings } = await sb.from('raw_enquiries')
					.select(`id, created_at, query_data, customer_details(customer_name)`)
					.in('id', allEnquiryIds);

				const otherLeads = siblings.filter(s => s.id !== primaryId);

				zone.innerHTML = `
					<div class="text-left bg-slate-900/50 p-6 rounded-2xl border border-white/10 shadow-xl">
						<div class="flex justify-between items-center mb-6">
							<div>
								<h4 class="text-xs font-black text-white tracking-tight uppercase">Cluster Identification</h4>
								<p class="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-1">Found ${otherLeads.length} related records for this email</p>
							</div>
							<button onclick="toggleAllSiblings(this)" class="px-4 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[8px] font-black text-indigo-400 uppercase hover:bg-white/10 transition">Select All</button>
						</div>

						<div class="space-y-2 max-h-48 overflow-y-auto mb-6 pr-2 custom-scrollbar">
							<div class="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center gap-4">
								<input type="checkbox" checked disabled class="w-4 h-4 accent-indigo-400 opacity-50">
								<div class="flex-1 grid grid-cols-2 text-[9px] font-bold text-white uppercase tracking-widest items-center">
									<span class="truncate">Current Master Lead</span>
									<span class="text-right text-indigo-400">Primary</span>
								</div>
							</div>

							${otherLeads.map(s => `
								<div class="p-3 bg-white/5 border border-white/5 rounded-xl flex items-center gap-4 hover:border-indigo-500/30 transition group">
									<input type="checkbox" class="sibling-checkbox w-4 h-4 accent-indigo-600" value="${s.id}" checked>
									<div class="flex-1 grid grid-cols-2 text-[9px] font-bold text-slate-300 uppercase tracking-widest items-center">
										<span class="truncate">Enquiry: ${new Date(s.created_at).toLocaleDateString()}</span>
										<span class="text-right text-slate-500 group-hover:text-indigo-400">ID: ${s.id.slice(0,8)}</span>
									</div>
								</div>
							`).join('')}
						</div>

						<div class="flex flex-col gap-3">
							<input id="project-name" type="text" placeholder="Assign Global Project Name...(Required)*" 
								class="w-full px-4 py-2.5 bg-slate-950 border border-white/10 rounded-xl text-[11px] font-bold text-white outline-none focus:ring-1 focus:ring-indigo-500">
							<button onclick="executeBulkOnboarding('${primaryId}', '${email}')" 
								class="w-full py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-500 transition shadow-lg shadow-indigo-500/20">
								Confirm & Launch Project
							</button>
						</div>
					</div>
				`;
				lucide.createIcons();
			} catch (err) { zone.innerHTML = `<p class="text-[9px] text-red-400 text-center uppercase font-black">Cluster Scan Failed</p>`; }
		}
		
		function goToProjectFromEnquiry(projectId) {
			// 1. Close the Lead/Enquiry Modal
			const leadModal = document.getElementById('lead-modal');
			if (leadModal) leadModal.classList.add('hidden');

			// 2. Switch the main view to 'projects'
			switchTab('projects');

			// 3. Open the specific project workspace
			// We wrap this in a tiny timeout to ensure the view switch completes
			setTimeout(() => {
				openProjectWorkspace(projectId);
				
				// Success feedback
				if (typeof showToast === 'function') {
					showToast("Navigated to Project Workspace", "success");
				}
			}, 100);
		}
		
		async function executeBulkOnboarding(primaryId, email) {
			const zone = document.getElementById('onboarding-zone');
			const projectNameInput = document.getElementById('project-name').value;
			const newProjectId = crypto.randomUUID();
			const checkboxes = document.querySelectorAll('.sibling-checkbox:checked');
			const idsToLink = [primaryId, ...Array.from(checkboxes).map(cb => cb.value)];

			zone.innerHTML = `<div class="py-10 text-slate-400 text-[10px] font-black animate-pulse uppercase">Allocating Workspace ID...</div>`;

			try {
				await sb.from('projects').insert({
					id: newProjectId,
					enquiry_id: primaryId,
					project_name: projectNameInput,
					current_phase: 'Onboarding',
					client_email: email
				});

				await sb.from('enquiry_details').update({ project_id: newProjectId, is_project: true, status_id: 5 }).in('enquiry_id', idsToLink);
				
				alert(`PROJECT LIVE: ${newProjectId.slice(0,8)} created.`);
				closeModal();
				fetchAdminData();
			} catch (err) { alert("Execution failed."); searchSiblingsForOnboarding(primaryId, email); }
		}

		async function saveLeadChanges(leadId) {
			const saveBtn = document.getElementById('save-btn');
			const name = document.getElementById('edit-name').value;
			const phone = document.getElementById('edit-phone').value;
			const statusId = document.getElementById('edit-status').value;

			saveBtn.disabled = true;
			saveBtn.innerText = "SYNCING...";

			await Promise.all([
				sb.from('customer_details').update({ customer_name: name, phone_number: phone }).eq('enquiry_id', leadId),
				sb.from('enquiry_details').update({ status_id: statusId }).eq('enquiry_id', leadId)
			]);
			
			saveBtn.innerText = "VERIFIED!";
			setTimeout(() => {
				closeModal();
				fetchAdminData();
				saveBtn.innerText = "Save All Changes";
				saveBtn.disabled = false;
			}, 1000);
		}

		async function addComment(leadId) {
			const commentText = document.getElementById('new-comment').value;
			if (!commentText.trim()) return;
			
			try {
				const isAdmin = window.currentUserProfile.is_admin === true;
				const payload = {
					enquiry_id: leadId,
				};
				
				if (isAdmin) {
					payload.org_comments = commentText; // Admin/Internal column
					payload.comments = null;
				} else {
					payload.comments = commentText;     // Client/External column
					payload.org_comments = null;
				}
				
				//await sb.from('enquiry_comments').insert({ enquiry_id: leadId, comments: commentText, org_comments: "Admin Note" });
				const { error } = await sb.from('enquiry_comments').insert([payload]);
				if (error) throw error;
				manageLead(leadId);
			} catch (err) {
				console.error('Error adding enquiry comment:', err);
			}
		}

		function getQuoteHTML(q, images) {
			if (!q) return '';
			return `
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Flat Type</p>
						<p class="text-xs font-bold text-white">${q.flat_type}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Bedrooms</p>
						<p class="text-xs font-bold text-white">${q.bedrooms}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Living Rooms</p>
						<p class="text-xs font-bold text-white">${q.living_rooms}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Kitchens</p>
						<p class="text-xs font-bold text-white">${q.kitchens}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Washrooms</p>
						<p class="text-xs font-bold text-white">${q.washrooms}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Indoor temple</p>
						<p class="text-xs font-bold text-white">${q.puja_ghar}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Dining space</p>
						<p class="text-xs font-bold text-white">${q.dining}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Balconies</p>
						<p class="text-xs font-bold text-white">${q.balcony}</p>
					</div>
					<div class="p-4 bg-slate-900/50 border border-white/5 rounded-2xl">
						<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Area</p>
						<p class="text-xs font-bold text-white">${q.area_sqft} Sqft</p>
					</div>
					<div class="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
						<p class="text-[7px] font-black text-indigo-400 uppercase tracking-widest mb-1">Package</p>
						<p class="text-xs font-bold text-indigo-300">${q.package}</p>
					</div>
				</div>
				${images.length > 0 ? `
					<div class="flex gap-2 overflow-x-auto py-2 scrollbar-hide">
						${images.map(img => `
							<img src="${img.image_url}" class="h-16 w-16 object-cover rounded-lg border border-white/10 flex-shrink-0">
						`).join('')}
					</div>
				` : ''}
			`;
		}

		async function initializeClientDashboard(email) {
			const container = document.getElementById('client-activity-content');
			container.innerHTML = `<div class="py-20 text-center animate-pulse text-slate-400 font-bold text-[10px] uppercase tracking-widest">Loading Projects...</div>`;

			try {
				// Step 1: Fetch Projects for this client
				const { data: projects, error: pError } = await sb
					.from('projects')
					.select('*')
					.eq('client_email', email);

				if (pError || !projects.length) {
					container.innerHTML = `<div class="p-20 glass-panel rounded-3xl text-center text-slate-500 uppercase font-bold text-xs tracking-widest border border-dashed border-white/10">No active projects found.</div>`;
					return;
				}

				// Step 2: Render Project Cards
				container.innerHTML = projects.map(proj => `
					<div class="glass-panel p-8 rounded-[32px] border border-white/10 mb-6 hover:border-indigo-500/30 transition-all group">
						<div class="flex flex-col lg:flex-row justify-between gap-6 mb-8">
							<div>
								<div class="flex items-center gap-3 mb-2">
									<span class="px-3 py-1 bg-indigo-500/20 text-indigo-400 text-[9px] font-black uppercase rounded-lg tracking-widest">Active Project</span>
									<span class="text-slate-500 text-[9px] font-bold uppercase tracking-widest">${new Date(proj.created_at).toLocaleDateString()}</span>
								</div>
								<h2 class="text-3xl font-black text-white tracking-tighter uppercase">${proj.project_name}</h2>
							</div>
							<div class="text-right">
								<p class="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Current Phase</p>
								<span class="text-xl font-bold text-emerald-400 uppercase tracking-tighter">${proj.current_phase}</span>
							</div>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
							<div class="md:col-span-2">
								<div class="flex justify-between items-end mb-2">
									<span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Construction Progress</span>
									<span class="text-lg font-black text-white">${proj.progress_percent || 0}%</span>
								</div>
								<div class="w-full h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
									<div class="h-full bg-gradient-to-r from-indigo-600 to-emerald-500 transition-all duration-1000 shadow-[0_0_15px_rgba(79,70,229,0.3)]" style="width: ${proj.progress_percent || 0}%"></div>
								</div>
							</div>
							
							<div class="bg-white/5 rounded-2xl p-4 border border-white/5">
								<p class="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Architect Name</p>
								<p class="text-xs font-bold text-slate-200 uppercase">${proj.assigned_lead || 'Not Assigned'}</p>
							</div>
						</div>

						<div class="flex flex-col sm:flex-row gap-3">
							<button onclick="openProjectWorkspace('${proj.id}')" class="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98]">
								Enter Project Workspace
							</button>
							
							<a href="tel:+91XXXXXXXXXX" class="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-4 rounded-2xl text-[10px] font-black uppercase text-white transition flex items-center justify-center gap-2">
								<i data-lucide="phone" class="w-3.5 h-3.5"></i> Call Office
							</a>

							<a href="https://wa.me/91XXXXXXXXXX?text=Hi, regarding ${proj.project_name}..." target="_blank" class="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 py-4 rounded-2xl text-[10px] font-black uppercase text-white transition flex items-center justify-center gap-2">
								<i data-lucide="message-circle" class="w-3.5 h-3.5 text-emerald-400"></i> WhatsApp
							</a>
						</div>
					</div>
				`).join('');

				lucide.createIcons();
			} catch (err) {
				container.innerHTML = "Error syncing project data.";
			}
		}
		
		let activeProjectId = null;
		let activeEnquiryIds = []; // Global to keep track of IDs for messaging

		async function openProjectWorkspace(projectId) {
			activeProjectId = projectId;
			const workspace = document.getElementById('project-workspace');
			workspace.classList.remove('hidden');
			document.body.style.overflow = 'hidden';

			try {
				const { data: proj } = await sb.from('projects').select('*').eq('id', projectId).single();
				const { data: enqLinks } = await sb.from('enquiry_details').select('enquiry_id').eq('project_id', projectId);
				const enqIds = enqLinks ? enqLinks.map(l => l.enquiry_id) : [];

				const [rawRes, quoteRes, customerRes, allFilesRes] = await Promise.all([
					sb.from('raw_enquiries').select('id, is_quote').in('id', enqIds),
					sb.from('quote_details').select('*').in('enquiry_id', enqIds),
					sb.from('customer_details').select('*').in('enquiry_id', enqIds),
					sb.from('project_files').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
				]);

				// SEPARATION LOGIC: Find the invoice for the sidebar, filter it out for the assets grid
				const invoiceData = allFilesRes.data?.find(f => f.is_invoice === true);
				const assetsOnly = allFilesRes.data?.filter(f => f.is_invoice !== true) || [];

				let projectSite = "", projectArea = "N/A", projectType = "General Enquiry";
				const quoteEnquiry = rawRes.data?.find(r => r.is_quote === true);
				if (quoteEnquiry) {
					const qDetail = quoteRes.data?.find(q => q.enquiry_id === quoteEnquiry.id);
					if (qDetail) {
						projectSite = [qDetail.pincode, qDetail.landmark, qDetail.city].filter(Boolean).join(', ');
						projectArea = qDetail.area_sqft ? `${qDetail.area_sqft} Sq. Ft.` : "N/A";
						projectType = qDetail.flat_type || "Standard Project";
					}
				}

				const phases = ['Initiation', 'Design Concept', 'Procurement', 'Installation', 'Handover'];
				const dbPhase = (proj.current_phase || "").trim().toLowerCase();
				const currentIdx = phases.findIndex(p => p.toLowerCase() === dbPhase);

				document.getElementById('luxury-timeline').innerHTML = `
					<div class="mb-10 px-2">
						<h4 class="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Project Progress</h4>
						${phases.map((phase, i) => {
							const isCompleted = i < currentIdx;
							const isActive = i === currentIdx;
							return `
								<div class="relative pl-12 mb-10 last:mb-0">
									${i !== phases.length - 1 ? `<div class="absolute left-[15px] top-8 w-[2px] h-full ${i < currentIdx ? 'bg-indigo-500' : 'bg-white/5'}"></div>` : ''}
									<div class="absolute left-0 top-0 w-8 h-8 rounded-full border-2 z-10 flex items-center justify-center transition-all duration-700 
										${isCompleted ? 'bg-indigo-600 border-indigo-400 shadow-[0_0_15px_rgba(79,70,229,0.4)]' : isActive ? 'bg-white border-white shadow-[0_0_20px_rgba(255,255,255,0.3)]' : 'bg-slate-900 border-white/10'}">
										${isCompleted ? '<i data-lucide="check" class="w-4 h-4 text-white"></i>' : `<span class="text-[10px] font-black ${isActive ? 'text-black' : 'text-slate-600'}">${i + 1}</span>`}
									</div>
									<div class="transition-all duration-500 ${isActive ? 'translate-x-2' : ''}">
										<h4 class="text-[11px] font-black uppercase tracking-[0.2em] ${isActive ? 'text-white' : isCompleted ? 'text-indigo-300' : 'text-slate-600'}">${phase}</h4>
									</div>
								</div>`;
						}).join('')}
					</div>

					<div class="mb-10 p-5 bg-white/5 rounded-3xl border border-white/10 space-y-4">
						<div class="flex justify-between items-center mb-2 px-1">
							<h4 class="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em]">Project Overview</h4>
							<label class="flex items-center gap-2 ${window.currentUserProfile?.is_admin ? 'cursor-pointer' : 'cursor-not-allowed'} group">
								<span class="text-[8px] font-black text-slate-500 uppercase">Estimation Submitted</span>
								<input id="update-eta-submitted" 
									   type="checkbox" 
									   ${proj.eta_submitted ? 'checked' : ''} 
									   ${!window.currentUserProfile?.is_admin ? 'disabled' : ''}
									   onchange="handleEtaToggle(this, '${proj.id}')"
									   class="w-4 h-4 rounded border-white/10 bg-slate-900 accent-indigo-500 ${!window.currentUserProfile?.is_admin ? 'opacity-50' : 'cursor-pointer'}">
							</label>
						</div>

						<div class="space-y-1.5">
							<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1">Project Name</label>
							<input id="update-project-name" type="text" value="${proj.project_name || ''}" class="w-full px-4 py-2 bg-slate-950 border border-white/5 rounded-xl text-[11px] font-bold text-white outline-none focus:border-indigo-500 transition-all">
						</div>
						
						${window.currentUserProfile?.is_admin ? `
							<button onclick="confirmDeleteProject('${projectId}')" 
									class="flex items-center gap-2 px-4 py-2 bg-rose-600/10 border border-rose-500/20 text-rose-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all active:scale-95">
								<i data-lucide="trash-2" class="w-3 h-3"></i>
								Delete Project
							</button>
						` : ''}

						<div class="space-y-1.5">
							<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1">Project Site</label>
							<textarea id="update-project-site" rows="2" class="w-full px-4 py-2 bg-slate-950 border border-white/5 rounded-xl text-[11px] font-bold text-white outline-none focus:border-indigo-500 transition-all">${projectSite}</textarea>
						</div>

						<div class="grid grid-cols-2 gap-3">
							<div class="space-y-1.5">
								<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1">Project Cost</label>
								<input id="update-project-cost" type="number" step="0.01" value="${proj.project_cost || ''}" placeholder="0.00" ${!proj.eta_submitted ? 'disabled' : ''} class="w-full px-4 py-2 bg-slate-950 border border-white/5 rounded-xl text-[11px] font-bold text-white outline-none focus:border-indigo-500 transition-all">
							</div>
							<div class="space-y-1.5">
								<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest ml-1">ETA</label>
								<input id="update-eta" type="date" value="${proj.eta ? new Date(proj.eta).toISOString().split('T')[0] : ''}" ${!window.currentUserProfile?.is_admin ? 'disabled' : ''} class="w-full px-4 py-2 bg-slate-950 border border-white/5 rounded-xl text-[11px] font-bold text-white outline-none focus:border-indigo-500 transition-all">
							</div>
						</div>

						<div class="p-4 bg-slate-950/50 rounded-2xl border border-white/5">
							<div class="flex justify-between items-center mb-3">
								<label class="text-[8px] font-black text-slate-500 uppercase tracking-widest">Estimation Invoice</label>
								${window.currentUserProfile?.is_admin ? `
									<label class="text-[8px] font-black text-indigo-400 uppercase cursor-pointer hover:text-white transition-all">
										Upload New <input type="file" class="hidden" onchange="uploadProjectInvoice(this, '${projectId}')">
									</label>
								` : ''}
							</div>
							${invoiceData ? `
								<a href="${invoiceData.img_url}" target="_blank" class="flex items-center gap-3 p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-all">
									<i data-lucide="file-text" class="w-4 h-4 text-indigo-400"></i>
									<span class="text-[10px] font-bold text-white uppercase truncate">View Invoice</span>
									<i data-lucide="external-link" class="w-3 h-3 text-slate-500 ml-auto"></i>
								</a>
							` : `<p class="text-[9px] text-slate-600 italic">No invoice uploaded</p>`}
						</div>

						<div class="grid grid-cols-2 gap-3 pt-2">
							<div class="p-3 bg-slate-900/50 rounded-xl border border-white/5">
								<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Area</p>
								<p class="text-[10px] font-bold text-indigo-400">${projectArea}</p>
							</div>
							<div class="p-3 bg-slate-900/50 rounded-xl border border-white/5">
								<p class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1">Type</p>
								<p class="text-[10px] font-bold text-white truncate">${projectType}</p>
							</div>
						</div>

						<button id="overview-save-btn" onclick="saveProjectOverview('${projectId}', ${JSON.stringify(enqIds)})" class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg flex items-center justify-center gap-2">
							<i data-lucide="save" class="w-3.5 h-3.5"></i> Update Project Details
						</button>
					</div>
					
					<div id="project-artifacts-container" class="glass-panel rounded-3xl border border-white/10 overflow-hidden mt-8">
						<div class="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
							<div>
								<h3 class="text-sm font-black text-white uppercase tracking-tight">Project Artifacts</h3>
								<p class="text-[9px] text-slate-500 font-bold uppercase tracking-widest mt-1">Itemized Estimation & Billing</p>
							</div>
							${window.currentUserProfile?.is_admin ? `
								<button onclick="openArtifactModal()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[9px] font-black uppercase transition-all shadow-lg shadow-indigo-500/20 active:scale-95">
									+ Add New Item
								</button>
							` : ''}
						</div>

						<div class="overflow-x-auto custom-scrollbar">
							<table class="w-full text-left text-[10px] min-w-[700px]">
								<thead class="bg-slate-950/50 text-slate-400 font-black uppercase tracking-widest">
									<tr>
										<th class="p-4 sticky left-0 bg-slate-900/90 backdrop-blur-md z-10 border-r border-white/5">Item Details</th>
										<th class="p-4 text-center">Qty</th>
										<th class="p-4 text-center">Unit Cost</th>
										<th class="p-4 text-right">Total</th>
										<th class="p-4 text-center">Action</th>
									</tr>
								</thead>
								<tbody id="artifacts-tbody-${projectId}">
									</tbody>
							</table>
						</div>
					</div>

					<div id="artifact-modal" class="fixed inset-0 z-[110] flex items-center justify-center p-4 opacity-0 pointer-events-none transition-all duration-300">
						<div class="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onclick="closeArtifactModal()"></div>
						<div class="relative bg-slate-900 border border-white/10 w-full max-w-md rounded-3xl p-8 shadow-2xl transform scale-95 transition-transform duration-300" id="artifact-modal-content">
							<div class="flex items-center justify-between mb-6">
								<h4 class="text-sm font-black text-white uppercase tracking-widest">New Artifact</h4>
								<button onclick="closeArtifactModal()" class="text-slate-500 hover:text-white transition-colors">
									<i data-lucide="x" class="w-5 h-5"></i>
								</button>
							</div>
							
							<div class="space-y-4">
								<div class="space-y-1">
									<label class="text-[8px] font-black uppercase text-slate-500 ml-1">Item Name</label>
									<input type="text" id="art-name" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-indigo-500 outline-none transition-colors">
								</div>
								<div class="space-y-1">
									<label class="text-[8px] font-black uppercase text-slate-500 ml-1">Details</label>
									<textarea id="art-details" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-indigo-500 outline-none min-h-[80px] transition-colors"></textarea>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<div class="space-y-1">
										<label class="text-[8px] font-black uppercase text-slate-500 ml-1">Quantity</label>
										<input type="number" id="art-qty" value="1" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-indigo-500 outline-none">
									</div>
									<div class="space-y-1">
										<label class="text-[8px] font-black uppercase text-slate-500 ml-1">Unit Price (₹)</label>
										<input type="number" id="art-cost" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-indigo-500 outline-none">
									</div>
								</div>
								<button id="save-art-btn" onclick="saveArtifact('${projectId}')" class="w-full bg-indigo-600 text-white h-12 rounded-xl text-[10px] font-black uppercase hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-500/20 mt-4">
									Confirm & Add
								</button>
							</div>
						</div>
					</div>
					
					<div class="mb-6 space-y-3">
						<h4 class="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em] px-2">Customer Contacts</h4>
						${(customerRes.data || []).map(cust => `
							<div class="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between group">
								<div>
									<p class="text-[10px] font-black text-white uppercase">${cust.customer_name || 'Unnamed'}</p>
									<p class="text-[9px] text-slate-500 font-bold">${cust.phone_number || 'No Contact'}</p>
								</div>
								<div class="flex gap-2">
									${cust.whatsapp_updates && window.currentUserProfile?.is_admin ? `
										<a href="https://wa.me/${cust.phone_number.replace(/\D/g,'')}" target="_blank" class="w-8 h-8 flex items-center justify-center bg-emerald-500/10 text-emerald-500 rounded-xl hover:bg-emerald-500 hover:text-white transition-all">
											<i data-lucide="message-circle" class="w-4 h-4"></i>
										</a>` : ''}
									<a href="mailto:${cust.email_id}" class="w-8 h-8 flex items-center justify-center bg-indigo-500/10 text-indigo-500 rounded-xl hover:bg-indigo-500 hover:text-white transition-all">
										<i data-lucide="mail" class="w-4 h-4"></i>
									</a>
								</div>
							</div>`).join('')}
					</div>
				`;

				// Update Title
				document.getElementById('workspace-title-area').innerHTML = `
					<h1 class="text-4xl font-black text-white tracking-tighter uppercase">${proj.project_name}</h1>
					<p class="text-indigo-400 font-bold text-[10px] uppercase tracking-widest mt-1">${proj.client_email}</p>
				`;
				// Initial Fetch
				renderArtifacts(projectId);
				
				// RENDER FILTERED ASSETS (Excludes the Invoice)
				renderWorkspaceAssets(assetsOnly);
				await loadWorkspaceChat(activeProjectId);
				document.getElementById('overview-save-btn').onclick = () => saveProjectOverview(projectId, enqIds);
				setTimeout(() => refreshProjectFinancials(projectId), 200);
				const recordBtn = document.getElementById('global-record-payment-btn');
				if (recordBtn) {
					// We attach the specific project ID to the button's click event right now
					recordBtn.onclick = () => openPaymentModal(projectId); 
				}
				lucide.createIcons();

			} catch (err) {
				console.error("Workspace Error:", err);
			}
		}

		async function saveProjectOverview(projectId, enqIds) {
			const saveBtn = document.getElementById('overview-save-btn');
			const updateData = {
				project_name: document.getElementById('update-project-name').value,
				project_cost: document.getElementById('update-project-cost').value,
				eta: document.getElementById('update-eta').value || null,
				eta_submitted: document.getElementById('update-eta-submitted').checked
			};

			saveBtn.innerText = "UPDATING...";
			saveBtn.disabled = true;

			try {
				// 1. Update Project Table
				const { error: pError } = await sb.from('projects').update(updateData).eq('id', projectId);
				if (pError) throw pError;

				// 2. Update Site Details in quote_details
				const newSite = document.getElementById('update-project-site').value;
				const { data: quotes } = await sb.from('raw_enquiries').select('id').eq('is_quote', true).in('id', enqIds);
				
				if (quotes && quotes.length > 0) {
					await sb.from('quote_details').update({ landmark: newSite }).eq('enquiry_id', quotes[0].id);
				}

				saveBtn.innerText = "CHANGES SAVED";
				document.querySelector('#workspace-title-area h1').innerText = updateData.project_name;

				setTimeout(() => {
					saveBtn.innerHTML = `<i data-lucide="save" class="w-3.5 h-3.5"></i> Update Project Details`;
					saveBtn.disabled = false;
					lucide.createIcons();
				}, 2000);

			} catch (err) {
				console.error("Update Error:", err);
				saveBtn.innerText = "ERROR SAVING";
				saveBtn.disabled = false;
			}
		}

		async function uploadProjectInvoice(input, projectId) {
			if (!input.files || input.files.length === 0) return;
			const file = input.files[0];
			const fileExt = file.name.split('.').pop();
			const filePath = `invoices/${projectId}/${Date.now()}.${fileExt}`;

			try {
				// 1. Upload to Storage
				const { error: uploadError } = await sb.storage.from('portal-files').upload(filePath, file);
				if (uploadError) throw uploadError;

				// 2. Get URL
				const { data: { publicUrl } } = sb.storage.from('portal-files').getPublicUrl(filePath);

				// 3. Insert into project_files
				await sb.from('project_files').insert({
					project_id: projectId,
					uploaded_by: window.userSession?.id,
					img_url: publicUrl,
					is_invoice: true
				});

				alert("Invoice uploaded successfully");
				openProjectWorkspace(projectId); // Refresh to show the link
			} catch (err) {
				console.error("Invoice Upload Error:", err);
				alert("Failed to upload invoice");
			}
		}

		function renderWorkspaceAssets(files) {
			const container = document.getElementById('workspace-assets');
			const assetsList = Array.isArray(files) ? files : [];
			const currentUserId = window.userSession?.id;
			
			if (assetsList.length === 0) {
				container.innerHTML = `
					<div class="col-span-full py-12 text-center text-slate-600 text-[9px] font-black uppercase tracking-[0.3em] border border-dashed border-white/5 rounded-3xl">
						No documents uploaded
					</div>`;
				return;
			}
			
			const uploaderIds = [...new Set(assetsList.map(f => f.uploaded_by).filter(id => id))];
			if (currentUserId && !uploaderIds.includes(currentUserId)) uploaderIds.push(currentUserId);

			sb.from('profiles')
				.select('id, is_admin, email')
				.in('id', uploaderIds)
				.then(({ data: profiles, error }) => {
					if (error) {
						console.error("Profile fetch error:", error);
						return;
					}

					// 2. Identify if the person VIEWING the workspace is an admin
					const viewerProfile = profiles?.find(p => p.id === currentUserId);
					const viewerIsAdmin = viewerProfile?.is_admin === true;

				// Tabular Design Implementation
				container.innerHTML = `
					<div class="col-span-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900/40 backdrop-blur-md">
						<div class="overflow-x-auto">
							<table class="w-full text-left border-collapse">
								<thead>
									<tr class="bg-white/5 border-b border-white/10">
										<th class="px-6 py-5 text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">Document Name</th>
										<th class="px-6 py-5 text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">Description / Content</th>
										<th class="px-6 py-5 text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">Uploaded By</th>
										<th class="px-6 py-5 text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">Uploaded Date</th>
										<th class="px-6 py-5 text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] text-right">Actions</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-white/5">
									${assetsList.map(file => {
										// Formatting the date
										const date = new Date(file.created_at).toLocaleDateString('en-IN', {
											day: '2-digit', 
											month: 'short', 
											year: 'numeric'
										});
										
										// Handling file name (stripping UUID prefix if possible, or using full name)
										// Note: Using file.img_url to get the filename if your DB column 'name' isn't set yet
										const rawFileName = file.img_url ? file.img_url.split('/').pop() : 'Unnamed File';
										const displayName = rawFileName.substring(rawFileName.indexOf('-') + 1);
										
										// Logic for "Uploaded By" label
										const uploader = profiles?.find(p => p.id === file.uploaded_by);
										const uploaderLabel = uploader?.is_admin ? "Admin" : (uploader?.email || "Unknown");

										// Permission Check: Admin can delete anything. Clients can only delete their own.
										const isOwner = file.uploaded_by === currentUserId;
										const canDelete = viewerIsAdmin || isOwner;
										
										return `
										<tr class="hover:bg-white/[0.02] transition-all group">
											<td class="px-4 py-3">
												<div class="flex items-center gap-3">
													<div class="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
														<i data-lucide="file-text" class="w-5 h-5"></i>
													</div>
													<div>
														<p class="text-sm font-bold text-slate-200">${displayName}</p>
														<p class="text-[9px] text-slate-500 font-black uppercase tracking-widest mt-0.5">Asset ID: ${file.id.substring(0,8)}</p>
													</div>
												</div>
											</td>
											<td class="px-4 py-3 whitespace-nowrap">
												<p class="text-xs text-slate-400 leading-relaxed italic opacity-60">
													${file.content || "Standard Project Documentation"}
												</p>
											</td>
											<td class="px-4 py-3 whitespace-nowrap">
												<span class="text-[10px] font-black uppercase tracking-widest ${uploaderLabel === 'Admin' ? 'text-indigo-400' : 'text-slate-500'}">
													${uploaderLabel}
												</span>
											</td>
											<td class="px-4 py-3 whitespace-nowrap">
												<span class="px-3 py-1 rounded-full bg-slate-800 text-slate-400 text-[10px] font-bold border border-white/5">
													${date}
												</span>
											</td>
											<td class="px-4 py-3 text-right">
												<div class="flex justify-end items-center gap-2">
													<button onclick="window.open('${file.img_url}', '_blank')" 
														class="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all duration-300"
														title="View Document">
														<i data-lucide="external-link" class="w-4 h-4"></i>
													</button>
													${canDelete ? `
														<button onclick="deleteProjectAsset('${file.id}', '${file.img_url}')" 
															class="p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white transition-all">
															<i data-lucide="trash-2" class="w-4 h-4"></i>
														</button>
													` : `
														<div class="p-2 opacity-20" title="Only Admin can delete this file">
															<i data-lucide="lock" class="w-4 h-4 text-slate-600"></i>
														</div>
													`}
												</div>
											</td>
										</tr>`;
									}).join('')}
								</tbody>
							</table>
						</div>
					</div>
				`;
				
				// Crucial: Refresh Lucide icons after injecting HTML
				if (typeof lucide !== 'undefined') {
					lucide.createIcons();
				}
			})
		}

		async function confirmDeleteProject(projectId) {
			const doubleCheck = confirm("DANGER: This will permanently delete the project, all payment history, and financial records. This action cannot be undone. Proceed?");
			
			if (doubleCheck) {
				await executeProjectDeletion(projectId);
			}
		}

		async function executeProjectDeletion(projectId) {
			//loadAdminProjects()
			try {

				// 2. Delete Related Payments First (Foreign Key Constraint safety)
				await sb.from('payments').delete().eq('project_id', projectId);

				// 3. Update Leads back to 'qualified' (Optional: so they can be re-launched)
				await sb.from('enquiry_details').update({ project_id: null, status_id: 1, is_project : false }).eq('project_id', projectId);

				// 4. Delete the Project
				const { error } = await sb.from('projects').delete().eq('id', projectId);

				if (error) throw error;

				alert("Project successfully deleted.");

				closeWorkspace()

			} catch (err) {
				console.error("Deletion failed:", err);
				alert("Error: " + err.message);
				// Refresh to restore view in case of error
				openProjectWorkspace(projectId);
			}
		}

		async function deleteProjectAsset(recordId, fullImgUrl) {
			if (!confirm("Are you sure you want to permanently delete this file?")) return;

			if (!fullImgUrl) {
				console.error("Delete failed: No URL provided for the asset.");
				alert("Error: File path is missing. Please refresh and try again.");
				return;
			}

			try {
				// 1. ROBUST PATH EXTRACTION
				// The URL looks like: .../storage/v1/object/public/portal-files/PROJECT_ID/FILENAME.jpg
				// We need: "PROJECT_ID/FILENAME.jpg"
				const bucketName = 'portal-files';
				const urlParts = fullImgUrl.split(`${bucketName}/`);
				
				if (urlParts.length < 2) {
					throw new Error("Could not determine the file path from the URL provided.");
				}

				// Remove any URL parameters (like ?t=...) that Supabase adds for caching
				const storagePath = urlParts[1];

				console.log("Deleting from Storage:", storagePath);

				// 2. DELETE FROM STORAGE BUCKET
				const { error: storageError } = await sb.storage
					.from(bucketName)
					.remove([storagePath]);

				if (storageError) throw storageError;

				// 3. DELETE FROM DATABASE (project_files table)
				const { error: dbError } = await sb
					.from('project_files')
					.delete()
					.eq('id', recordId);

				if (dbError) {
					console.error("Database Deletion Error:", dbError.message);
					throw new Error("DB Error: " + dbError.message);
				}
				
				showToast("File deleted successfully", "success");	
					
				// 4. REFRESH UI
				// In your script, the ID is stored in currentProjectId globally
				if (activeProjectId) {
					await loadProjectAssets(activeProjectId);
				}

				console.log("Asset successfully removed from storage and database.");

			} catch (err) {
				console.error('Delete error:', err);
				alert('Delete failed: ' + err.message);
			}
		}
		
		// Helper function for the Success Message (if you don't have one)
		function showToast(message, type = "success") {
			const toast = document.createElement('div');
			toast.className = `fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest z-[100] transition-all duration-500 transform translate-y-20 shadow-2xl border ${
				type === 'success' 
				? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400' 
				: 'bg-red-500/10 border-red-500/50 text-red-400'
			}`;
			toast.style.backdropFilter = "blur(12px)";
			toast.innerText = message;
			
			document.body.appendChild(toast);
			
			// Animate In
			setTimeout(() => toast.classList.remove('translate-y-20'), 100);
			
			// Animate Out & Remove
			setTimeout(() => {
				toast.classList.add('translate-y-20', 'opacity-0');
				setTimeout(() => toast.remove(), 500);
			}, 3000);
		}
		
		
		async function loadProjectAssets(projectId) {
			try {
				const { data, error } = await sb
					.from('project_files')
					.select('*')
					.eq('project_id', projectId)
					.order('created_at', { ascending: false });

				if (error) throw error;
				renderWorkspaceAssets(data);
			} catch (err) {
				console.error('Error loading assets:', err);
			}
		}
		

		async function refreshAssets(projectId) {
			const { data: newFiles, error } = await sb
				.from('project_files')
				.select('*, profiles(email_id)')
				.eq('project_id', projectId)
				.order('created_at', { ascending: false });

			if (!error) renderWorkspaceAssets(newFiles);
		}

		async function sendWorkspaceMessage() {
			const input = document.getElementById('workspace-msg-input');
			const msg = input.value.trim();
			console.log('Active User: ', window.userSession.id)
			if (!msg || !activeProjectId) return;

			try {
				const { error } = await sb
					.from('project_comments') // Updated table name
					.insert([{
						project_id: activeProjectId,
						author_id: window.userSession.id, // Current logged-in user ID
						description: msg
					}]);

				if (error) throw error;

				input.value = '';
				await loadWorkspaceChat(activeProjectId);
			} catch (err) {
				console.error('Error sending message:', err);
				showToast("Message failed to send", "error");
			}
		}


		async function loadWorkspaceChat(projectId) {
			try {
				console.log('Project ID :', projectId)
				// We fetch from project_comments and JOIN with profiles to get the is_admin flag
				const { data, error } = await sb
					.from('project_comments')
					.select(`
						*,
						profiles:author_id (is_admin)
					`)
					.eq('project_id', projectId)
					.order('created_at', { ascending: true });

				if (error) throw error;
				
				// Always pass an array (data || []) to prevent the .map() error
				renderWorkspaceChat(data || []);
			} catch (err) {
				console.error('Chat Loading Error:', err);
				renderWorkspaceChat([]); 
			}
		}

		function renderWorkspaceChat(comments) {
			const container = document.getElementById('workspace-chat-log');
			if (!container) return;

			// Safety check to ensure comments is an array
			const chatItems = Array.isArray(comments) ? comments : [];

			container.innerHTML = chatItems.map(comment => {
				// The join from Step 1 provides comment.profiles.is_admin
				const isAuthorAdmin = comment.profiles?.is_admin === true;
				
				// ADMIN = LEFT, CLIENT = RIGHT
				const alignmentClass = isAuthorAdmin ? 'justify-start' : 'justify-end';
				const bubbleColor = isAuthorAdmin 
					? 'bg-slate-800/80 border border-white/10 rounded-2xl rounded-tl-none' 
					: 'bg-indigo-600 text-white rounded-2xl rounded-tr-none';

				return `
					<div class="flex ${alignmentClass} mb-4">
						<div class="max-w-[85%] ${bubbleColor} p-4 shadow-xl">
							<div class="flex items-center gap-2 mb-1">
								<span class="text-[7px] font-black uppercase tracking-widest opacity-60">
									${isAuthorAdmin ? 'Architect' : 'Client'}
								</span>
							</div>
							<p class="text-xs leading-relaxed font-medium">${comment.description}</p>
							<div class="mt-2 text-[7px] opacity-40 uppercase font-bold text-right">
								${new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
							</div>
						</div>
					</div>
				`;
			}).join('');

			container.scrollTop = container.scrollHeight;
		}

		function closeWorkspace() {
			document.getElementById('project-workspace').classList.add('hidden');
			document.body.style.overflow = 'auto';
			if (window.currentProjectSub) {
				sb.removeChannel(window.currentProjectSub);
			}
			if (typeof loadAdminProjects === "function") {
				loadAdminProjects();
			}
		}
		
		
		async function handleProjectUpload(input) {
			const file = input.files[0];
			if (!file || !activeProjectId) return;
			
			const label = input.parentElement;
			const originalHTML = label.innerHTML;
			label.innerHTML = `<span class="animate-pulse text-indigo-400 font-black text-[10px] tracking-widest">UPLOADING...</span>`;
			
			try {
				const { data: { user } } = await sb.auth.getUser();
				const fileExt = file.name.split('.').pop();
				const fileName = `${activeProjectId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

				// 1. Upload to Storage ONLY
				const { error: uploadError } = await sb.storage.from('portal-files').upload(fileName, file);
				if (uploadError) throw uploadError;

				const { data: { publicUrl } } = sb.storage.from('portal-files').getPublicUrl(fileName);

				// 2. Store data in memory and show Modal
				pendingUploadData = { publicUrl, userId: user.id };
				document.getElementById('description-step-modal').classList.remove('hidden');
				label.innerHTML = originalHTML;
				lucide.createIcons();

			} catch (err) {
				alert("Upload failed: " + err.message);
				label.innerHTML = originalHTML;
			} finally {
				input.value = ''; // Reset input
			}
		}
		
		async function finalizeAssetUpload() {
			const category = document.getElementById('modal-category').value;
			const subCategory = document.getElementById('modal-sub-category').value;
			const customDesc = document.getElementById('modal-custom-desc').value;
			
			// MANDATORY VALIDATION
			if (!category || category === "") {
				alert("Please select a Space Category.");
				return;
			}

			if (!subCategory || subCategory === "") {
				alert("Please select a specific Area.");
				return;
			}

			const finalContent = (subCategory === 'Others') ? customDesc : subCategory;
			if (subCategory === 'Others' && !customDesc) {
				alert("Please specify the custom name.");
				return;
			}

			try {
				const { error: dbError } = await sb.from('project_files').insert([{
					project_id: activeProjectId,
					img_url: pendingUploadData.publicUrl,
					content: finalContent,
					uploaded_by: pendingUploadData.userId
				}]);

				if (dbError) throw dbError;

				// Cleanup
				document.getElementById('description-step-modal').classList.add('hidden');
				document.getElementById('modal-category').value = '';
				document.getElementById('modal-custom-desc').value = '';
				pendingUploadData = null;
				
				loadProjectAssets(activeProjectId);
			} catch (err) {
				alert("Error saving file info: " + err.message);
			}
		}
		
        function toggleAllSiblings(btn) {
			const checks = document.querySelectorAll('.sibling-checkbox');
			const newState = !checks[0]?.checked;
			checks.forEach(c => c.checked = newState);
			btn.innerText = newState ? "Deselect All" : "Select All";
		}

        async function sendRegistrationInvite(email, customerName, leadId) {
			try {
				// 1. Create the registration link pointing to your index.html
				// We add 'email' and 'mode' as URL parameters to make it easy for the client
				const registrationLink = `${window.location.origin}/index.html?email=${encodeURIComponent(email)}&mode=register`;

				// 2. The message content as per your requirement
				const invitationMessage = `Dear ${customerName}, 

		Welcome to Nivas Kunj! We are happy to get you onboarded to our project. 

		Please register yourself using the link below to get project live updates, tracking, and all related documents:

		${registrationLink}

		Note: Please use this email (${email}) during registration to ensure your project data is synced correctly.`;

				// 3. Log the invite in the system history
				await sb.from('enquiry_comments').insert({
					enquiry_id: leadId,
					org_comments: `SYSTEM: Invitation link generated and sent to ${email}. Link : ${registrationLink}`,
					created_at: new Date()
				});

				// 4. Open the Admin's default email app (Gmail/Outlook) with everything pre-filled
				const subject = encodeURIComponent("Welcome to Nivas Kunj | Project Onboarding");
				const body = encodeURIComponent(invitationMessage);
				window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;

				alert("Invitation prepared! Please send the email from your mail client.");
				
				// Refresh UI
				if (typeof manageLead === 'function') manageLead(leadId);

			} catch (err) {
				console.error("Invite Error:", err);
				alert("Failed to generate invite: " + err.message);
			}
		}

		function closeModal() { document.getElementById('lead-modal').classList.add('hidden'); }
		async function handleLogout() { await sb.auth.signOut(); window.location.href = 'index.html'; }
        lucide.createIcons();
		
		async function viewClientComments(enquiryId) {
			const modal = document.getElementById('lead-modal');
			const content = document.getElementById('modal-body-content');
			const title = document.getElementById('modal-title');
			const subtitle = document.getElementById('modal-subtitle');
			
			modal.classList.remove('hidden');
			title.innerText = "Discussion Board";
			subtitle.innerText = "Project Conversation Profile";
			content.innerHTML = `<div class="py-10 text-center animate-pulse text-slate-500 text-[10px] font-bold uppercase tracking-widest">Opening Secure Channel...</div>`;

			try {
				const { data: comments, error } = await sb
					.from('enquiry_comments')
					.select('*')
					.eq('enquiry_id', enquiryId)
					.order('created_at', { ascending: true }); // Changed to Ascending for natural chat flow

				if (error) throw error;

				if (!comments || comments.length === 0) {
					content.innerHTML = `<div class="text-center py-20 text-slate-600 text-[10px] font-black uppercase tracking-widest italic">No messages exchanged yet.</div>`;
					lucide.createIcons();
					return;
				}

				content.innerHTML = `
					<div class="flex flex-col gap-6 max-h-[65vh] overflow-y-auto pr-4 custom-scrollbar p-2">
						${comments.map(c => {
							const isCompany = c.org_comments && c.org_comments.trim() !== "";
							const messageText = isCompany ? c.org_comments : c.comments;
							
							return `
								<div class="flex ${isCompany ? 'justify-start' : 'justify-end'} w-full">
									<div class="max-w-[85%] md:max-w-[70%] flex flex-col ${isCompany ? 'items-start' : 'items-end'}">
										<div class="flex items-center gap-2 mb-1.5 px-1">
											${isCompany ? '<span class="text-[7px] font-black text-indigo-400 uppercase tracking-widest">Nivas Kunj Studio</span>' : ''}
											<span class="text-[7px] text-slate-500 font-bold">${new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
											${!isCompany ? '<span class="text-[7px] font-black text-emerald-500 uppercase tracking-widest">You</span>' : ''}
										</div>

										<div class="${isCompany 
											? 'bg-slate-900 border border-white/10 text-slate-200 rounded-2xl rounded-tl-none' 
											: 'bg-indigo-600 text-white rounded-2xl rounded-tr-none shadow-lg shadow-indigo-500/10'} 
											p-4 text-xs font-medium leading-relaxed">
											${messageText}
										</div>
										
										<span class="text-[6px] text-slate-600 mt-1 uppercase font-bold tracking-tighter">
											${new Date(c.created_at).toLocaleDateString()}
										</span>
									</div>
								</div>
							`;
						}).join('')}
					</div>
				`;
				
				// Auto-scroll to bottom of chat
				setTimeout(() => {
					const container = content.querySelector('.custom-scrollbar');
					if (container) container.scrollTop = container.scrollHeight;
				}, 100);

				lucide.createIcons();
			} catch (err) {
				console.error(err);
				content.innerHTML = `<p class="text-red-400 text-center text-[10px] font-black uppercase py-10">Sync Failed</p>`;
			}
		}
		
		async function loadAdminProjects() {
			const grid = document.getElementById('projects-grid');
			const pg = document.getElementById('pagination-controls');
			grid.innerHTML = `<div class="col-span-full p-20 text-center animate-pulse text-slate-400 font-bold text-[10px] uppercase tracking-widest">Filtering Projects...</div>`;

			let query = sb.from('projects').select('*', { count: 'exact' });

			// Use the value from the search bar
			const searchVal = document.getElementById('leadSearch').value.toLowerCase();
			if (searchVal) {
				query = query.or(`project_name.ilike.%${searchVal}%,client_email.ilike.%${searchVal}%`);
			}

			// Use the value from the sort dropdown
			const sortVal = document.getElementById('sortOrder').value;
			if (sortVal === 'newest') query = query.order('created_at', { ascending: false });
			else if (sortVal === 'oldest') query = query.order('created_at', { ascending: true });
			else query = query.order('project_name', { ascending: true });

			// Pagination range
			const start = (currentPage - 1) * itemsPerPage;
			const end = start + itemsPerPage - 1;
			query = query.range(start, end);

			const { data: projects, count, error } = await query;
			if (error) return console.error(error);

			renderPagination(count);

			if (!projects || projects.length === 0) {
				grid.innerHTML = `<div class="col-span-full p-20 text-center text-slate-500 text-[10px] font-bold uppercase tracking-widest border border-dashed border-white/10 rounded-[32px]">No projects found</div>`;
				pg.innerHTML = '';
				return;
			}

			const phases = ['Initiation', 'Design Concept', 'Procurement', 'Installation', 'Handover'];
			grid.innerHTML = projects.map(proj => `
				<div class="glass-panel p-6 rounded-[32px] border border-white/5 hover:border-indigo-500/30 transition-all group">
					<div class="mb-6 flex justify-between items-start">
						<div>
							<h3 class="text-lg font-black text-white uppercase tracking-tighter">${proj.project_name}</h3>
							<p class="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">${proj.client_email}</p>
						</div>
					</div>

					<div class="grid grid-cols-2 gap-3 mb-4">
						<div>
							<label class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Phase</label>
							<select onchange="updateProjectField('${proj.id}', 'current_phase', this.value)" 
									class="w-full bg-slate-950 border border-white/10 rounded-xl py-2 px-2 text-[9px] font-bold text-white outline-none">
								${phases.map(p => `<option value="${p}" ${proj.current_phase === p ? 'selected' : ''}>${p}</option>`).join('')}
							</select>
						</div>
						<div>
							<label class="text-[7px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Completion</label>
							<select onchange="updateProjectField('${proj.id}', 'progress_percent', parseInt(this.value))" 
									class="w-full bg-slate-950 border border-white/10 rounded-xl py-2 px-2 text-[9px] font-bold text-white outline-none">
								${[0, 10, 25, 50, 75, 100].map(v => `<option value="${v}" ${proj.progress_percent === v ? 'selected' : ''}>${v}%</option>`).join('')}
							</select>
						</div>
					</div>

					<div class="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mb-6">
						<div class="h-full bg-indigo-500 transition-all duration-700 shadow-[0_0_10px_rgba(79,70,229,0.4)]" style="width: ${proj.progress_percent}%"></div>
					</div>

					<button onclick="openProjectWorkspace('${proj.id}')" 
							class="w-full py-3 bg-white/5 border border-white/10 rounded-2xl text-[9px] font-black text-white uppercase tracking-widest hover:bg-white hover:text-black transition-all">
						Enter Control Room
					</button>
				</div>
			`).join('');
			lucide.createIcons();
		}

		// Single function to update any field in the projects table
		async function updateProjectField(projectId, field, value) {
			const updateData = {};
			updateData[field] = value;

			const { error } = await sb.from('projects').update(updateData).eq('id', projectId);
			
			if (error) {
				console.error("Update failed:", error);
			} else {
				// Refresh grid to reflect the UI changes (like the progress bar width)
				loadAdminProjects();
			}
		}
		
		let paymentChartInstance = null;

		async function refreshProjectFinancials(projectId) {
			if (!projectId) return;

			// 1. Fetch Data
			const { data: project } = await sb.from('projects')
				.select('created_at, eta, project_cost, eta_submitted')
				.eq('id', projectId).single();

			const { data: payments } = await sb.from('payments')
				.select('payment_amt, created_at, payment_status')
				.eq('project_id', projectId)
				.order('created_at', { ascending: true });

			if (!project) return;

			const startDate = new Date(project.created_at);
			const endDate = new Date(project.eta || project.created_at); // Fallback if ETA missing
			
			// 2. Update Labels (Confirmed Only)
			const confirmed = (payments || []).filter(p => p.payment_status === 3);
			const totalPaid = confirmed.reduce((sum, p) => sum + (p.payment_amt || 0), 0);
			const amountDue = Math.max(0, project.project_cost - totalPaid);

			const summaryLabels = document.getElementById('financial-summary-labels');
			if (project.project_cost && project.eta_submitted) {
				summaryLabels.classList.remove('hidden');
				document.getElementById('label-total-paid').innerText = `₹${totalPaid.toLocaleString('en-IN')}`;
				document.getElementById('label-amount-due').innerText = `₹${amountDue.toLocaleString('en-IN')}`;
			}

			// 3. Prepare Time-Series Data Points
			let runningTotal = 0;
			const chartPoints = [];
			
			// Start point: Project Creation
			chartPoints.push({ x: new Date(project.created_at).getTime(), y: 0 });

			// Payment points: Each confirmed payment creates a "step"
			confirmed.forEach(p => {
				runningTotal += parseFloat(p.payment_amt);
				chartPoints.push({ x: new Date(p.created_at).getTime(), y: runningTotal });
			});

			// End point: Current time (keeps the line flat to today)
			chartPoints.push({ x: Date.now(), y: runningTotal });

			// 4. Render Graph
			const ctx = document.getElementById('paymentChart').getContext('2d');
			if (paymentChartInstance) paymentChartInstance.destroy();

			paymentChartInstance = new Chart(ctx, {
				type: 'line',
				data: {
					datasets: [{
						data: chartPoints,
						borderColor: '#6366f1',
						backgroundColor: 'rgba(99, 102, 241, 0.1)',
						fill: true,
						stepped: true, // Creates the vertical rise at the exact moment of payment
						borderWidth: 2,
						pointRadius: 3,
						pointBackgroundColor: '#6366f1',
						tension: 0
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: {
						x: {
							type: 'time',
							time: {
								// REMOVE unit: 'day' to allow automatic scaling
								displayFormats: {
									day: 'MMM d',
									month: 'MMM yyyy',
									year: 'yyyy'
								}
							},
							grid: { 
								display: false,
								drawBorder: false 
							},
							ticks: { 
								color: '#64748b', 
								font: { size: 9, weight: '800' },
								autoSkip: true, // This prevents labels from overlapping
								maxRotation: 0,
								major: { enabled: true } // Makes month/year labels stand out
							},
							// Ensure the chart spans the whole project duration
							min: startDate.getTime(),
							max: endDate.getTime()
						},
						y: {
							beginAtZero: true,
							max: project.project_cost,
							grid: { color: 'rgba(255,255,255,0.05)' },
							ticks: {
								color: '#64748b',
								font: { size: 9, weight: '800' },
								callback: (value) => '₹' + value.toLocaleString()
							}
						}
					},
					plugins: {
						legend: { display: false },
						zoom: {
							zoom: {
								wheel: { enabled: true }, // Zoom with mouse wheel
								pinch: { enabled: true }, // Zoom with fingers on mobile
								mode: 'x'
							},
							pan: {
								enabled: true,
								mode: 'x'
							}
						},
						tooltip: {
							callbacks: {
								title: (items) => new Date(items[0].parsed.x).toLocaleDateString(),
								label: (item) => ` Total Paid: ₹${item.parsed.y.toLocaleString()}`
							}
						}
					}
				}
			});
			updateRoadmap(startDate, endDate);
		}

		function updateRoadmap(start, end) {
			const now = new Date();
			const progress = Math.min(Math.max(((now - start) / (end - start)) * 100, 0), 100);
			document.getElementById('project-eta-fill').style.width = `${progress}%`;
			document.getElementById('label-start-date').innerText = start.toLocaleDateString();
			document.getElementById('label-eta-date').innerText = end.toLocaleDateString();
			const days = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
			document.getElementById('eta-days-count').innerText = days > 0 ? `${days} DAYS LEFT` : "COMPLETED";
		}

		async function openPaymentModal(projectId) {
			const modal = document.getElementById('payment-modal');
			
			// --- FIX STARTS HERE: RESET GATEWAY STATE ---
			const tableElement = document.getElementById('payment-history-rows').closest('table');
			const gatewayContainer = document.getElementById('gateway-container');
			
			// 1. Always show the table again
			if (tableElement) tableElement.classList.remove('hidden');
			
			// 2. Always hide the QR/Gateway container if it exists
			if (gatewayContainer) gatewayContainer.classList.add('hidden');

			modal.dataset.projectId = projectId;
			modal.classList.remove('hidden');
			
			document.getElementById('modal-project-id').innerHTML = `
				<div class="flex justify-between items-center w-full pr-4">
					<span>Project ID: ${projectId}</span>
				</div>
			`;
			modal.dataset.projectId = projectId; // Store for the 'Submit' action
			modal.classList.remove('hidden');

			const isAdmin = window.currentUserProfile?.is_admin;
			const adminSection = document.getElementById('admin-payment-section');
			
			// Fetch History & Statuses
			const [statusRes, payRes] = await Promise.all([
				sb.from('payment_status').select('*'),
				sb.from('payments').select('*').eq('project_id', projectId).order('installment_num', { ascending: true })
			]);

			const statuses = statusRes.data || [];
			const tableBody = document.getElementById('payment-history-rows');

			tableBody.innerHTML = payRes.data.map(p => {
				const s = statuses.find(st => st.id === p.payment_status);
				const isConfirmed = p.payment_status === 3; // Rule: Status 3 is Confirmed
				
				return `
					<tr class="border-b border-white/[0.02]">
						<td class="py-4 px-2">${p.installment_num}</td>
						<td class="py-4">${p.id.substring(0,8)}...</td>
						<td class="py-4">
							${(isAdmin && !isConfirmed) ? 
								`<input type="date" value="${p.next_payment_date?.split('T')[0]}" 
									   onchange="updatePaymentDate('${p.id}', this.value)" class="bg-transparent text-white border-none p-0 focus:ring-0">` : 
								new Date(p.created_at).toLocaleDateString()
							}
						</td>
						<td class="py-4 font-bold text-white">₹${p.payment_amt.toLocaleString()}</td>
						<td class="py-4">
							<span class="px-2 py-0.5 bg-white/5 rounded text-[9px] text-slate-400 border border-white/5 uppercase">
								${p.payment_mode || 'N/A'}
							</span>
						</td>
						<td class="py-4 text-slate-500 italic font-medium">
							${p.remarks || 'Standard Request'}
						</td>
						<td class="py-4 text-[8px] font-black uppercase tracking-widest ${isConfirmed ? 'text-emerald-400' : 'text-amber-400'}">
							${s?.status || 'Pending'}
						</td>
						<td class="py-4 text-right">
							${(!isAdmin && p.payment_status === 1) ? 
								`<button onclick="processPayment('${p.id}', ${p.payment_amt})" 
										 class="bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all shadow-lg shadow-indigo-500/20 active:scale-95">
									Pay Now
								</button>` : 
								`<i data-lucide="${isConfirmed ? 'check-circle' : 'clock'}" class="w-4 h-4 text-slate-600 inline-block"></i>`
							}
						</td>
					</tr>
				`;
			}).join('');

			isAdmin ? adminSection.classList.remove('hidden') : adminSection.classList.add('hidden');
			lucide.createIcons();
		}
		
		async function updatePaymentDate(paymentId, newDate) {
			const { error } = await sb.from('payments')
				.update({ next_payment_date: newDate })
				.eq('id', paymentId);
				
			if (error) {
				alert("Update failed: " + error.message);
			} else {
				// Optional: show a small success toast
				console.log("Date updated successfully");
			}
		}
		
		async function createNewPaymentEntry() {
			const modal = document.getElementById('payment-modal');
			const pId = modal.dataset.projectId; // Retrieving the ID we stored when opening
			const date = document.getElementById('new-pay-date').value;
			const amt = document.getElementById('new-pay-amt').value;

			// NEW: Capture Mode and Purpose
			const mode = document.getElementById('new-pay-mode').value;
			const purposeSelect = document.getElementById('new-pay-purpose').value;
			const customPurpose = document.getElementById('new-pay-purpose-custom').value;
			const finalRemarks = purposeSelect === 'Others' ? customPurpose : purposeSelect;

			if (!pId || !date || !amt || (purposeSelect === 'Others' && !customPurpose)) return alert("Please fill all fields");

			// --- ADDITIONAL CHECK: REMAINING AMOUNT VALIDATION ---
			const remainingText = document.getElementById('label-amount-due').innerText;
			// Remove Currency symbol and commas to get the pure number
			const remainingAmt = parseFloat(remainingText.replace(/[^\d.]/g, ''));
			const inputAmt = parseFloat(amt);

			if (inputAmt > remainingAmt) {
				return alert(`Validation Error: The requested amount (₹${inputAmt.toLocaleString('en-IN')}) exceeds the remaining balance (₹${remainingAmt.toLocaleString('en-IN')}).`);
			}

			const { error } = await sb.from('payments').insert({
				project_id: pId,
				payment_amt: parseFloat(amt),
				next_payment_date: date,
				payment_mode: mode,      // Mapping to DB
				remarks: finalRemarks,   // Mapping to DB
				payment_status: 1 // Default: Pending
				//installment_num: (count || 0) + 1
			});

			if (!error) {
				openPaymentModal(pId); // Refresh the table
				document.getElementById('new-pay-amt').value = '';
				document.getElementById('new-pay-date').value = '';
			} else {
				alert("Error creating entry: " + error.message);
			}
		}
		
		async function handleEtaToggle(el, projectId) {
			// Only admins can trigger this
			if (!window.currentUserProfile?.is_admin) return;

			const isChecked = el.checked;
			
			// Update Database
			const { error } = await sb
				.from('projects')
				.update({ eta_submitted: isChecked })
				.eq('id', projectId);

			if (error) {
				alert("Error: " + error.message);
				el.checked = !isChecked; // Revert UI on error
				return;
			}

			// --- INSTANT UI UPDATE ---
			const costInput = document.getElementById('update-project-cost');
			if (costInput) {
				// If checked, ENABLE the cost input. If unchecked, DISABLE it.
				costInput.disabled = !isChecked; 
				
				if (!isChecked) {
					costInput.classList.add('opacity-50', 'cursor-not-allowed');
				} else {
					costInput.classList.remove('opacity-50', 'cursor-not-allowed');
				}
			}

			// Refresh the financial labels (Amount Due etc.)
			refreshProjectFinancials(projectId);
		}
		
		//TODO Razorpay functionality pending
		
		async function processPayment(paymentId, amount) {
			const { data: payData, error } = await sb.from('payments')
				.select('payment_mode, project_id')
				.eq('id', paymentId).single();

			if (error) return alert("Error fetching payment details");

			const mode = payData.payment_mode || 'Cash';
			
			// Instead of opening 'lead-modal', we hide the history table 
			// and show the payment gateway in the same space.
			const historySection = document.getElementById('payment-history-rows').closest('table');
			const adminSection = document.getElementById('admin-payment-section');
			const modalTitle = document.getElementById('modal-project-id');

			// Hide background elements to make room for the Gateway
			if(adminSection) adminSection.classList.add('hidden');
			historySection.classList.add('hidden');
			
			// Change title to reflect Gateway mode
			modalTitle.innerHTML = `
				<div class="flex items-center gap-3 text-indigo-400">
					<button onclick="openPaymentModal('${payData.project_id}')" class="p-1 hover:bg-white/10 rounded-lg transition-all">
						<i data-lucide="arrow-left" class="w-4 h-4"></i>
					</button>
					<span class="text-xs font-black uppercase tracking-widest text-white">Secure Gateway: ${mode}</span>
				</div>`;

			// Create a container for the Gateway if it doesn't exist
			let gatewayContainer = document.getElementById('gateway-container');
			if (!gatewayContainer) {
				gatewayContainer = document.createElement('div');
				gatewayContainer.id = 'gateway-container';
				historySection.parentNode.insertBefore(gatewayContainer, historySection);
			}
			gatewayContainer.classList.remove('hidden');

			if (mode === 'UPI') {
				renderUPIFlow(paymentId, amount, payData.project_id, gatewayContainer);
			} else if (mode === 'Net Banking') {
				renderNetBankingFlow(paymentId, amount, payData.project_id, gatewayContainer);
			} else {
				renderCashFlow(paymentId, gatewayContainer);
			}
			
			if(window.lucide) lucide.createIcons();
		}
		
		function renderUPIFlow(id, amt, pId, container) {
			const vpa = "7378332802@ybl"; 
			const upiUrl = `upi://pay?pa=${vpa}&pn=Ranadeep Banik&am=${amt}&cu=INR`;
			const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUrl)}`;

			container.innerHTML = `
				<div class="py-10 text-center animate-in fade-in zoom-in duration-300">
					<h3 class="text-xs font-black text-slate-500 uppercase tracking-[0.2em] mb-6">Scan QR to Pay</h3>
					
					<div class="bg-white p-4 rounded-3xl inline-block mb-6 shadow-2xl shadow-indigo-500/20 border-4 border-indigo-500/10">
						<img src="${qrUrl}" class="w-56 h-56 rounded-lg">
					</div>

					<div class="max-w-xs mx-auto bg-slate-900/50 border border-white/5 rounded-2xl p-4 mb-8">
						<p class="text-[10px] text-slate-500 uppercase font-black mb-1">Amount Due</p>
						<p class="text-2xl font-black text-white">₹${amt.toLocaleString('en-IN')}</p>
					</div>

					<div class="flex flex-col gap-3 max-w-xs mx-auto">
						<button onclick="verifyPayment('${id}', '${pId}')" 
							class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-widest py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20">
							Verify My Payment
						</button>
						<button onclick="openPaymentModal('${pId}')" class="text-slate-500 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-all">
							Cancel & Go Back
						</button>
					</div>
				</div>
			`;
		}
		
		// --- NET BANKING FLOW ---
		function renderNetBankingFlow(id, amt, pId, container) {
			container.innerHTML = `
				<div class="py-6 px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
					<h3 class="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-6 text-center">Bank Transfer Details</h3>
					
					<div class="space-y-3 mb-8">
						<div class="bg-slate-950/80 p-4 rounded-xl border border-white/5">
							<p class="text-[8px] text-slate-500 uppercase font-bold mb-1">Beneficiary Name</p>
							<p class="text-xs text-white font-bold uppercase">Nivas Kunj Construction</p>
						</div>
						<div class="bg-slate-950/80 p-4 rounded-xl border border-white/5 relative group">
							<p class="text-[8px] text-slate-500 uppercase font-bold mb-1">Account Number</p>
							<p class="text-sm text-white font-mono font-bold tracking-wider">9876543210123</p>
							<span class="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] text-indigo-500 font-bold uppercase opacity-0 group-hover:opacity-100 transition-all">Click to Copy</span>
						</div>
						<div class="grid grid-cols-2 gap-3">
							<div class="bg-slate-950/80 p-4 rounded-xl border border-white/5">
								<p class="text-[8px] text-slate-500 uppercase font-bold mb-1">IFSC Code</p>
								<p class="text-xs text-white font-bold">HDFC0001234</p>
							</div>
							<div class="bg-slate-950/80 p-4 rounded-xl border border-white/5">
								<p class="text-[8px] text-slate-500 uppercase font-bold mb-1">Bank Name</p>
								<p class="text-xs text-white font-bold">HDFC Bank</p>
							</div>
						</div>
					</div>

					<div class="bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl mb-8 text-center">
						<p class="text-[10px] text-indigo-300 leading-relaxed font-medium">
							Transfer <span class="text-white font-black">₹${amt.toLocaleString('en-IN')}</span> via IMPS/NEFT. 
							After transfer, click the button below.
						</p>
					</div>

					<button onclick="verifyPayment('${id}', '${pId}', 5)" 
						class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-[10px] tracking-widest py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20">
						I Have Sent the Money
					</button>
				</div>
			`;
		}

		// --- CASH FLOW ---
		function renderCashFlow(id, container) {
			container.innerHTML = `
				<div class="py-12 px-6 text-center animate-in fade-in zoom-in duration-300">
					<div class="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-500 border border-amber-500/20">
						<i data-lucide="banknote" class="w-8 h-8"></i>
					</div>
					<h3 class="text-sm font-black text-white uppercase tracking-widest mb-4">Cash Payment Instruction</h3>
					<p class="text-slate-400 text-[11px] leading-relaxed mb-10 max-w-[280px] mx-auto">
						Please hand over the amount to your assigned Site Supervisor or visit our main office. 
						<br><br>
						Once handed over, the Admin will manually verify and update your digital receipt here.
					</p>
					<button onclick="openPaymentModal(document.getElementById('payment-modal').dataset.projectId)" 
						class="w-full bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest py-4 rounded-xl transition-all">
						Close & Go Back
					</button>
				</div>
			`;
			if(window.lucide) lucide.createIcons();
		}
		
		async function verifyPayment(paymentId, projectId, customStatus = 2) {
			const { error } = await sb.from('payments')
				.update({ payment_status: customStatus })
				.eq('id', paymentId);

			if (error) {
				alert("Error: " + error.message);
			} else {
				alert("Payment update sent to admin.");
				document.getElementById('lead-modal').classList.add('hidden'); // Fixed ID
				openPaymentModal(projectId); 
			}
		}
		
		async function generatePaymentPDF(activeProjectId) {
			const printArea = document.getElementById('printable-area');
			
			const { data: project, error } = await sb
				.from('projects')
				.select('project_name, client_email')
				.eq('id', activeProjectId)
				.single();

			if (error) {
				alert("Error fetching project details for PDF");
				return;
			}
			
			const { data: payments, error: paymentError } = await sb
            .from('payments')
            .select('installment_num, id, created_at, payment_amt, payment_status')
            .eq('project_id', activeProjectId)
            .eq('payment_status', 3)
            .order('installment_num', { ascending: true });
			
			if (paymentError) throw new Error("Error fetching payment history");
			
			if (!payments || payments.length === 0) {
				alert("No confirmed payments found to generate an invoice.");
				return;
			}
			
			const totalAmount = payments.reduce((sum, p) => sum + (Number(p.payment_amt) || 0), 0);

			// 3. Rebuild as a professional Invoice Document
			printArea.innerHTML = `
				<div style="padding: 60px; font-family: 'Inter', sans-serif; color: #0f172a; background: white; min-height: 100vh;">
					
					<div style="display: flex; justify-content: space-between; border-bottom: 4px solid #4f46e5; padding-bottom: 30px;">
						<div>
							<img src="https://github.com/ranadeep-banik137/NivasKunjInteriors/blob/main/logo%20transparent%20PNG.png?raw=true" style="height: 70px; margin-bottom: 15px;">
							<h2 style="margin: 0; font-size: 18px; font-weight: 800; color: #1e1b4b;">NIVAS KUNJ INTERIORS</h2>
							<p style="margin: 2px 0; font-size: 11px; color: #64748b;">118, Badurtala Lane, Krishnanagar</p>
							<p style="margin: 2px 0; font-size: 11px; color: #64748b;">Agartala, Tripura - 799001</p>
							<p style="margin: 2px 0; font-size: 11px; color: #64748b;">GSTIN: 29AAAAA0000A1Z5</p>
						</div>
						<div style="text-align: right;">
							<h1 style="margin: 0; font-size: 48px; font-weight: 900; color: #e2e8f0; letter-spacing: -2px; line-height: 1;">RECEIPT</h1>
							<p style="margin: 10px 0 0 0; font-size: 12px; font-weight: 700; color: #4f46e5;">Date: ${new Date().toLocaleDateString('en-IN')}</p>
							<p style="margin: 2px 0; font-size: 12px; font-weight: 700;">Ref: NK-${activeProjectId.substring(0,8).toUpperCase()}</p>
						</div>
					</div>

					<div style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 40px; margin-top: 40px;">
						<div>
							<h3 style="font-size: 10px; text-transform: uppercase; color: #64748b; margin-bottom: 10px; letter-spacing: 1px;">Billed For Project</h3>
							<p style="font-size: 20px; font-weight: 800; margin: 0; color: #1e1b4b;">Name : ${project.project_name}</p>
							<p style="font-size: 12px; color: #64748b; margin-top: 5px;">Client email : ${project.client_email}</p>
						</div>
						<div style="background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0;">
							<h3 style="font-size: 10px; text-transform: uppercase; color: #64748b; margin-bottom: 5px;">Payment Status</h3>
							<p style="font-size: 16px; font-weight: 800; color: #059669; margin: 0;">OFFICIALLY CONFIRMED</p>
						</div>
					</div>

					<table style="width: 100%; border-collapse: collapse; margin-top: 40px;">
						<thead>
							<tr>
								<th style="text-align: left; padding: 15px; background: #1e1b4b; color: white; font-size: 11px; text-transform: uppercase; border-radius: 8px 0 0 0;">Description</th>
								<th style="text-align: left; padding: 15px; background: #1e1b4b; color: white; font-size: 11px; text-transform: uppercase;">Transaction ID</th>
								<th style="text-align: left; padding: 15px; background: #1e1b4b; color: white; font-size: 11px; text-transform: uppercase;">Date</th>
								<th style="text-align: right; padding: 15px; background: #1e1b4b; color: white; font-size: 11px; text-transform: uppercase; border-radius: 0 8px 0 0;">Amount</th>
							</tr>
						</thead>
						<tbody>
							${payments.map(item => `
								<tr>
									<td style="padding: 15px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 600;">NKPMT${item.installment_num}</td>
									<td style="padding: 15px; border-bottom: 1px solid #e2e8f0; font-size: 12px; font-family: monospace; color: #64748b;">${item.id}</td>
									<td style="padding: 15px; border-bottom: 1px solid #e2e8f0; font-size: 13px;">${new Date(item.created_at).toLocaleDateString('en-IN')}</td>
									<td style="padding: 15px; border-bottom: 1px solid #e2e8f0; font-size: 14px; font-weight: 800; text-align: right;">₹${item.payment_amt.toLocaleString('en-IN')}</td>
								</tr>
							`).join('')}
						</tbody>
						<tfoot>
							<tr style="background: #f8fafc;">
								<td colspan="3" style="padding: 20px 15px; text-align: right; font-size: 12px; font-weight: 900; color: #1e1b4b; text-transform: uppercase; letter-spacing: 1px;">
									Total Paid Amount:
								</td>
								<td style="padding: 20px 15px; text-align: right; font-size: 16px; font-weight: 900; color: #4f46e5; border-bottom: 3px double #4f46e5;">
									₹${totalAmount.toLocaleString('en-IN')}
								</td>
							</tr>
						</tfoot>
					</table>

					<div style="margin-top: 100px; display: flex; justify-content: space-between; align-items: flex-end;">
						<div style="max-width: 400px;">
							<h4 style="font-size: 12px; margin-bottom: 10px;">Terms & Conditions:</h4>
							<p style="font-size: 10px; color: #94a3b8; line-height: 1.6;">
								1. This is a computer-generated receipt and requires no physical signature.<br>
								2. All payments listed above are confirmed and processed.<br>
								3. For any discrepancies, contact us on our email nivaskunj@gmail.com.
							</p>
						</div>
						<div style="text-align: center;">
							<img id="pdf-sig-img" src="https://github.com/ranadeep-banik137/Nivas-Kunj-Query-Manager/blob/main/sig.png?raw=true" 
								 style="height: 100px; margin-bottom: 5px; margin-left: 5px; mix-blend-mode: multiply;">
							<div style="border-top: 2px solid #1e1b4b; padding-top: 10px; width: 200px;">
								<p style="margin: 0; font-size: 12px; font-weight: 900;">Authorized Signatory</p>
								<p style="margin: 0; font-size: 10px; color: #64748b; font-weight: 600;">Deepjoy Banik, CEO & Founder</p>
							</div>
						</div>
					</div>
				</div>
			`;
			// 3. WAIT FOR IMAGES (Fixed null error)
			const logoImg = document.getElementById('pdf-logo-img');
			const sigImg = document.getElementById('pdf-sig-img');

			const waitImg = (img) => new Promise(res => {
				if (!img) return res(); // Safety check
				if (img.complete) res();
				else {
					img.onload = res;
					img.onerror = res;
				}
			});

			// Small timeout to ensure DOM has registered the new elements
			await new Promise(r => setTimeout(r, 100));
			await Promise.all([waitImg(logoImg), waitImg(sigImg)]);

			// 4. Trigger the Print
			window.print();
			
			// 5. Clean up
			printArea.innerHTML = '';
		}
		
		
		let pendingUploadData = null; // Global holder

		const spaceData = {
			bedroom: ['Bedroom-1', 'Bedroom-2', 'Bedroom-3', 'Bedroom-4', 'Bedroom-5'],
			washroom: ['Washroom-1', 'Washroom-2', 'Lavatory', 'Child Care'],
			lifestyle: ['Living Room', 'Store Room', 'Study Room', 'Puja Room', 'Hall-1', 'Hall-2'],
			kitchen: ['Kitchen-1', 'Kitchen-2', 'Dining Area', 'Sink Space'],
			lobby: ['Balcony-1', 'Balcony-2', 'Balcony-3', 'Lobby', 'Dry Balcony', 'Extra Space', 'Terrace Space', 'Parking'],
			others: ['Others']
		};

		function updateModalSubOptions() {
			const cat = document.getElementById('modal-category').value;
			const sub = document.getElementById('modal-sub-category');
			
			// BUG FIX: If category is empty, clear and disable the sub-category dropdown
			if (!cat || cat === "") {
				sub.innerHTML = '<option value="">Choose Area...</option>';
				sub.disabled = true;
				sub.classList.add('opacity-20', 'cursor-not-allowed');
				return;
			}

			// Enable and populate
			sub.disabled = false;
			sub.classList.remove('opacity-20', 'cursor-not-allowed');
			sub.innerHTML = '<option value="" selected disabled>Choose Specific Area...</option>' + 
							spaceData[cat].map(item => `<option value="${item}">${item}</option>`).join('');
			
			toggleModalOthers();
		}

		function toggleModalOthers() {
			const val = document.getElementById('modal-sub-category').value;
			const wrapper = document.getElementById('modal-others-wrapper');
			val === 'Others' ? wrapper.classList.remove('hidden') : wrapper.classList.add('hidden');
		}
		
		async function cancelAssetUpload() {
			if (!confirm("Discard this upload? The file will be deleted.")) return;

			if (pendingUploadData && pendingUploadData.publicUrl) {
				try {
					// Extract the file path from the public URL
					const bucketName = 'portal-files';
					const urlParts = pendingUploadData.publicUrl.split(`${bucketName}/`);
					if (urlParts.length >= 2) {
						const filePath = urlParts[1];
						// Delete from Supabase Storage
						await sb.storage.from(bucketName).remove([filePath]);
					}
				} catch (err) {
					console.error("Cleanup error:", err);
				}
			}

			// Reset UI and global state
			document.getElementById('description-step-modal').classList.add('hidden');
			document.getElementById('modal-category').value = "";
			document.getElementById('modal-sub-category').innerHTML = '<option value="">Choose Area...</option>';
			document.getElementById('modal-sub-category').disabled = true;
			pendingUploadData = null;
			
			// Refresh Lucide icons if needed
			lucide.createIcons();
		}
		
		async function openManualProjectModal() {
			const modal = document.getElementById('manual-project-modal');
			const select = document.getElementById('manual-enquiry-link');
			
			// Reset and show loading state
			select.innerHTML = '<option value="">Loading Enquiries...</option>';
			modal.classList.remove('hidden');

			try {
				// Fetch: Details (for filter) + Customers (for name) + Raw (for query)
				// Note: Supabase handles joins via the select string
				const { data: details, error: detailsErr } = await sb
				.from('enquiry_details')
				.select('enquiry_id')
				.eq('is_project', false);

				if (detailsErr) throw detailsErr;

				if (!details || details.length === 0) {
					select.innerHTML = '<option value="">No unlinked leads available</option>';
					return;
				}

				// Extract the array of IDs to search for in other tables
				const validIds = details.map(d => d.enquiry_id);

				// 3. Parallel Fetch: Get names from customer_details and query_data from raw_enquiries
				// Note: raw_enquiries uses 'id' column as requested
				const [resCust, resRaw] = await Promise.all([
					sb.from('customer_details').select('enquiry_id, customer_name').in('enquiry_id', validIds),
					sb.from('raw_enquiries').select('id, query_data').in('id', validIds)
				]);

				if (resCust.error) throw resCust.error;
				if (resRaw.error) throw resRaw.error;

				// Populate dropdown
				let html = '<option value="">-- No Linked Lead --</option>';
				
				
				details.forEach(detail => {
					// Match customer name
					const customer = resCust.data.find(c => c.enquiry_id === detail.enquiry_id);
					// Match raw query (mapping detail.enquiry_id to raw_enquiries.id)
					const raw = resRaw.data.find(r => r.id === detail.enquiry_id);
				
					if (customer && raw) {
						const name = customer.customer_name || 'Unnamed Client';
						const query = raw.query_data || 'No description';
						const shortQuery = query.length > 35 ? query.substring(0, 35) + '...' : query;
						
						html += `<option value="${detail.enquiry_id}">${name.toUpperCase()} | ${shortQuery}</option>`;
					}
				});
				
				select.innerHTML = html;

			} catch (err) {
				console.error("Fetch Enquiries Error:", err);
				select.innerHTML = '<option value="">Failed to load enquiries</option>';
			}

			lucide.createIcons();
		}

		function closeManualProjectModal() {
			document.getElementById('manual-project-modal').classList.add('hidden');
			document.getElementById('manual-project-name').value = '';
			document.getElementById('manual-client-email').value = '';
			document.getElementById('manual-enquiry-link').value = ''; // Reset link
		}

		async function handleManualProjectCreation() {
			const name = document.getElementById('manual-project-name').value;
			const email = document.getElementById('manual-client-email').value;
			const linkedEnquiryId = document.getElementById('manual-enquiry-link').value;
			const btn = document.getElementById('manual-proj-btn');

			if (!name || !email) {
				alert("Please provide both Name and Client Email.");
				return;
			}

			btn.disabled = true;
			btn.innerText = "ESTABLISHING...";

			try {
				const newProjectId = crypto.randomUUID();

				// 1. Insert the Project
				const { error: projError } = await sb.from('projects').insert({
					id: newProjectId,
					project_name: name,
					client_email: email,
					current_phase: 'Onboarding',
					enquiry_id: linkedEnquiryId || null // Link if selected, else null
				});

				if (projError) throw projError;

				// 2. If an enquiry was linked, mark it as a project in enquiry_details
				if (linkedEnquiryId) {
					const { error: updateError } = await sb
						.from('enquiry_details')
						.update({ 
							is_project: true,
							project_id: newProjectId,
							status_id: 5 // Set to "Converted" status
						})
						.eq('enquiry_id', linkedEnquiryId);

					if (updateError) throw updateError;
				}

				alert(`PROJECT ESTABLISHED: ${name}`);
				closeManualProjectModal();
				if (typeof fetchAdminData === 'function') fetchAdminData();

			} catch (err) {
				console.error(err);
				alert("Failed to create manual project: " + err.message);
			} finally {
				btn.disabled = false;
				btn.innerText = "Establish Project";
			}
		}
		
		let currentClientView = 'projects';

		async function toggleClientView(view) {
			currentClientView = view;
			const email = window.userSession.email;
			
			// Update Button Styles
			const pBtn = document.getElementById('btn-client-projects');
			const eBtn = document.getElementById('btn-client-enquiries');
			
			if (view === 'projects') {
				pBtn.className = "px-6 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all bg-indigo-600 text-white shadow-lg";
				eBtn.className = "px-6 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all text-slate-500 hover:text-white";
				initializeClientDashboard(email);
			} else {
				eBtn.className = "px-6 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all bg-indigo-600 text-white shadow-lg";
				pBtn.className = "px-6 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all text-slate-500 hover:text-white";
				fetchClientEnquiries(email);
			}
		}
		
		
		async function fetchClientEnquiries(email) {
			const container = document.getElementById('client-activity-content');
			container.innerHTML = `<div class="py-20 text-center animate-pulse text-slate-400 font-bold text-[10px] uppercase tracking-widest">Gathering your history...</div>`;

			try {
				// 1. Fetch enquiry_ids linked to this email
				const { data: customers, error: err1 } = await sb
					.from('customer_details')
					.select('enquiry_id')
					.eq('email_id', email);

				if (err1) throw err1;
				if (!customers || customers.length === 0) {
					container.innerHTML = `<div class="p-20 bg-white/5 rounded-[40px] text-center text-slate-500 uppercase font-bold text-xs tracking-widest border border-dashed border-white/10">No records found for ${email}.</div>`;
					return;
				}

				const enquiryIds = customers.map(c => c.enquiry_id);

				// 2. Fetch Detailed Data (Added is_quote to select)
				const [rawRes, detailRes] = await Promise.all([
					sb.from('raw_enquiries').select('id, query_data, created_at, is_quote').in('id', enquiryIds),
					sb.from('enquiry_details').select('enquiry_id, status_id, is_project').in('enquiry_id', enquiryIds)
				]);

				if (rawRes.error) throw rawRes.error;
				if (detailRes.error) throw detailRes.error;

				// 3. Manual Join and Render
				let html = '';
				enquiryIds.forEach(id => {
					const raw = rawRes.data.find(r => r.id === id);
					const detail = detailRes.data.find(d => d.enquiry_id === id);
					
					if (raw) {
						const queryText = raw.query_data || 'Requirement details pending';
						const date = new Date(raw.created_at).toLocaleDateString();
						const isProject = detail?.is_project === true;
						
						// Determine Type Label
						const typeLabel = raw.is_quote ? 'Detailed Quote' : 'Direct Enquiry';
						const typeColor = raw.is_quote ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' : 'text-indigo-400 border-indigo-500/20 bg-indigo-500/5';

						html += `
							<div class="bg-slate-900/40 backdrop-blur-xl p-8 rounded-[40px] border border-white/10 hover:border-indigo-500/30 transition-all animate-slide-up">
								<div class="flex flex-col md:flex-row justify-between gap-6">
									<div class="flex-1">
										<div class="flex items-center gap-3 mb-4">
											<span class="px-3 py-1 bg-white/5 text-slate-500 text-[9px] font-black uppercase rounded-lg tracking-widest border border-white/5">Ref: ${id.slice(0,8)}</span>
											
											<span class="px-3 py-1 ${typeColor} text-[9px] font-black uppercase rounded-lg tracking-widest border">
												${typeLabel}
											</span>

											<span class="px-3 py-1 ${isProject ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-400 bg-white/5 border-white/5'} text-[9px] font-black uppercase rounded-lg tracking-widest border">
												${isProject ? 'Project Active' : 'In Review'}
											</span>
										</div>
										<h3 class="text-2xl font-black text-white tracking-tighter uppercase mb-2 line-clamp-1">${queryText}</h3>
										<p class="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Submitted on ${date}</p>
									</div>
									<div class="flex items-center">
										<button onclick="manageLead('${id}')" class="w-full md:w-auto bg-white/5 hover:bg-white/10 border border-white/10 text-white px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all active:scale-95">
											Track Progress
										</button>
									</div>
								</div>
							</div>
						`;
					}
				});

				container.innerHTML = html || `<div class="p-20 text-center text-slate-500 font-bold uppercase text-[10px] tracking-widest">No details available.</div>`;

			} catch (err) {
				console.error("Client Enquiry Fetch Error:", err);
				container.innerHTML = `<div class="p-20 text-center text-rose-400 font-bold text-[10px] uppercase tracking-widest">Sync Error: ${err.message}</div>`;
			}
		}
		async function fetchUsers() {
			const tbody = document.getElementById('users-table-body');
			tbody.innerHTML = `<tr><td colspan="3" class="py-20 text-center animate-pulse text-slate-500 font-bold uppercase text-[10px] tracking-widest">Syncing Profiles...</td></tr>`;

			try {
				const { data: users, error } = await sb.from('profiles').select('*').order('email');
				if (error) throw error;

				tbody.innerHTML = users.map(user => {
				// Check if this row belongs to the logged-in user
				const isSelf = user.id === window.userSession.id;

				return `
					<tr class="border-b border-white/5 hover:bg-white/[0.02] transition-all group">
						<td class="px-8 py-6">
							<div class="flex items-center gap-4">
								<div class="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-black text-xs">
									${(user.email || 'U').charAt(0).toUpperCase()}
								</div>
								<div class="flex-1">
									<input type="text" value="${user.full_name || ''}" 
										onchange="updateUserInfo('${user.id}', 'full_name', this.value)"
										class="bg-transparent border-none text-sm font-bold text-white focus:ring-0 p-0 w-full hover:bg-white/5 rounded px-1 transition-all"
										${isSelf ? 'title="Use Profile Settings to change your name"' : ''}>
									<p class="text-[10px] text-slate-500 font-medium">${user.email} ${isSelf ? '<span class="text-indigo-400 font-bold ml-2">(YOU)</span>' : ''}</p>
								</div>
							</div>
						</td>
						<td class="px-8 py-6">
							<select onchange="updateUserInfo('${user.id}', 'is_admin', this.value === 'true')" 
								${isSelf ? 'disabled' : ''}
								class="bg-slate-900 border border-white/5 rounded-lg text-[9px] font-black uppercase px-3 py-1.5 text-slate-400 focus:border-indigo-500 ${isSelf ? 'opacity-50 cursor-not-allowed' : ''}">
								<option value="false" ${!user.is_admin ? 'selected' : ''}>Client</option>
								<option value="true" ${user.is_admin ? 'selected' : ''}>Admin</option>
							</select>
						</td>
						<td class="px-8 py-6 text-right">
							<div class="flex justify-end gap-2">
								<button onclick="sendPasswordReset('${user.email}')" title="Send Access Mail" class="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl hover:bg-indigo-600 hover:text-white transition-all">
									<i data-lucide="mail-warning" class="w-4 h-4"></i>
								</button>
								${isSelf ? `
									<button disabled title="You cannot delete your own account" class="p-2.5 bg-white/5 text-slate-600 rounded-xl cursor-not-allowed opacity-30">
										<i data-lucide="user-minus" class="w-4 h-4"></i>
									</button>
								` : `
									<button onclick="deleteUser('${user.id}')" title="Delete User" class="p-2.5 bg-rose-500/10 text-rose-500 rounded-xl hover:bg-rose-600 hover:text-white transition-all">
										<i data-lucide="user-minus" class="w-4 h-4"></i>
									</button>
								`}
							</div>
						</td>
					</tr>
				`;
			}).join('');
				lucide.createIcons();
			} catch (e) {
				console.error(e);
			}
		}
		
		// 1. Update Name or Role
		async function updateUserInfo(userId, field, value) {
		
			if (userId === window.userSession.id && field === 'is_admin') {
				alert("Security Restriction: You cannot change your own administrative role.");
				fetchUsers(); // Reset UI
				return;
			}
			// 1. ADD CONFIRMATION FOR ROLE CHANGES
			if (field === 'is_admin') {
				const msg = `CRITICAL: You are about to change this user's role to ${value === true ? 'ADMIN' : 'CLIENT'}.\n\n` +
							(value === true ? 
							"This will grant them FULL administrative access to all leads, projects, and financials." : 
							"This will REVOKE their admin access. They will only see their own projects.");
				
				if (!confirm(msg)) {
					// If they cancel, we need to refresh the table to reset the dropdown visually
					fetchUsers(); 
					return;
				}
			}

			// 2. PROCEED WITH UPDATE
			const { error } = await sb.from('profiles').update({ [field]: value }).eq('id', userId);
			
			if (error) {
				alert("Sync Error: " + error.message);
				fetchUsers(); // Refresh to show actual database state
			} else {
				// Success notification (Optional)
				console.log(`User ${userId} updated: ${field} -> ${value}`);
			}
		}

		// 2. Password Reset (Sends Official Supabase Reset Email)
		async function sendPasswordReset(email) {
			const { error } = await sb.auth.resetPasswordForEmail(email, {
				redirectTo: window.location.origin + '/portal.html',
			});
			if (error) alert("Error: " + error.message);
			else alert("Success! A recovery link has been sent to " + email);
		}

		// 3. Delete User Profile
		async function deleteUser(id) {
			if (!confirm("Are you sure? This user will lose access to the portal immediately.")) return;
			const { error } = await sb.from('profiles').delete().eq('id', id);
			if (error) alert(error.message);
			else fetchUsers();
		}
		
		// 1. Modal Toggle Functions
		function openArtifactModal() {
			const modal = document.getElementById('artifact-modal');
			const content = document.getElementById('artifact-modal-content');
			modal.classList.remove('opacity-0', 'pointer-events-none');
			content.classList.remove('scale-95');
			lucide.createIcons();
		}

		function closeArtifactModal() {
			const modal = document.getElementById('artifact-modal');
			const content = document.getElementById('artifact-modal-content');
			modal.classList.add('opacity-0', 'pointer-events-none');
			content.classList.add('scale-95');
			// Clear inputs
			['art-name', 'art-details', 'art-cost'].forEach(id => document.getElementById(id).value = '');
			document.getElementById('art-qty').value = '1';
		}

		// 2. Save Artifact & Success Feedback
		async function saveArtifact(projectId) {
			const btn = document.getElementById('save-art-btn');
			const name = document.getElementById('art-name').value;
			const details = document.getElementById('art-details').value;
			const qty = parseFloat(document.getElementById('art-qty').value) || 0;
			const cost = parseFloat(document.getElementById('art-cost').value) || 0;

			if (!name || cost <= 0) return;

			btn.disabled = true;
			btn.innerHTML = '<span class="animate-pulse">Processing...</span>';

			const { error } = await sb.from('project_artifacts').insert([{
				project_id: projectId,
				item_name: name,
				details: details,
				quantity: qty,
				cost_per_item: cost
			}]);

			if (!error) {
				btn.innerHTML = '✓ Success!';
				btn.classList.replace('bg-indigo-600', 'bg-emerald-600');
				
				setTimeout(() => {
					closeArtifactModal();
					renderArtifacts(projectId);
					// Reset button
					btn.disabled = false;
					btn.innerHTML = 'Confirm & Add';
					btn.classList.replace('bg-emerald-600', 'bg-indigo-600');
				}, 1000);
			} else {
				alert("Sync Error: " + error.message);
				btn.disabled = false;
				btn.innerHTML = 'Confirm & Add';
			}
		}

		// 3. Render Artifacts (Refreshes list)
		async function renderArtifacts(projectId) {
			const tbody = document.getElementById(`artifacts-tbody-${projectId}`);
			if (!tbody) return;

			const { data, error } = await sb.from('project_artifacts')
				.select('*')
				.eq('project_id', projectId)
				.order('created_at', { ascending: true });

			if (error || !data.length) {
				tbody.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-slate-600 text-[9px] font-black uppercase tracking-widest">No artifacts found</td></tr>`;
				return;
			}

			tbody.innerHTML = data.map(item => `
				<tr class="border-t border-white/5 hover:bg-white/5 transition-colors">
					<td class="p-4 sticky left-0 bg-slate-900/95 z-10 border-r border-white/5">
						<div class="font-bold text-white text-[11px] uppercase">${item.item_name}</div>
						<div class="text-[8px] text-slate-500 font-medium uppercase mt-0.5 truncate max-w-[150px]">${item.details || ''}</div>
					</td>
					<td class="p-4 text-center text-slate-300 font-bold">x ${item.quantity}</td>
					<td class="p-4 text-center text-slate-300 font-bold">₹${item.cost_per_item.toLocaleString()}</td>
					<td class="p-4 text-right font-black text-indigo-400">₹${formatCurrency(item.total_cost)}</td>
					<td class="p-4 text-center">
						<button onclick="generatePDFInvoice('${item.project_id}')" class="p-2 bg-white/5 text-slate-400 hover:text-white hover:bg-indigo-600 rounded-lg transition-all shadow-sm">
							<i data-lucide="download-cloud" class="w-3.5 h-3.5"></i>
						</button>
					</td>
				</tr>
			`).join('');
			lucide.createIcons();
		}

		const formatCurrency = (amount) => {
			return Number(amount || 0).toLocaleString('en-IN', {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			});
		};

		async function generatePDFInvoice(projectId) {
			const printArea = document.getElementById('printable-area');

			const [projRes, artifactsRes] = await Promise.all([
				sb.from('projects').select('*').eq('id', projectId).single(),
				sb.from('project_artifacts').select('*').eq('project_id', projectId)
			]);

			if (projRes.error) return alert("Error fetching project data.");

			const project = projRes.data;
			const artifacts = artifactsRes.data || [];

			const { data: customer } = await sb.from('customer_details')
				.select('*')
				.eq('enquiry_id', project.enquiry_id)
				.single();

			const subTotal = artifacts.reduce((sum, item) => sum + (item.quantity * item.cost_per_item), 0);
			const discountPercent = Number(project.discount) || 0;
			const discountAmount = (subTotal * discountPercent) / 100;
			const grandTotal = subTotal - discountAmount;
			const roundedTotal = Math.round(grandTotal);
			const roundOffAmount = roundedTotal - grandTotal;

			printArea.innerHTML = `
				<div style="padding:80px 70px; font-family:'Inter',sans-serif; color:#1e293b; background:#ffffff; min-height:100vh;">

					<!-- HEADER -->
					<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:70px;">
						<div>
							<img id="inv-logo"
								 src="https://github.com/ranadeep-banik137/NivasKunjInteriors/blob/main/logo%20transparent%20PNG.png?raw=true"
								 style="height:55px; margin-bottom:18px;">

							<h2 style="margin:0; font-weight:900; letter-spacing:1px; font-size:22px; color:#111827;">
								NIVAS KUNJ
							</h2>

							<p style="margin-top:6px; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:#6b7280;">
								Luxury Interiors & Architecture
							</p>
						</div>

						<div style="text-align:right;">
							<h1 style="font-size:34px; font-weight:900; margin:0; letter-spacing:4px;">
								INVOICE
							</h1>
							<p style="margin-top:12px; font-size:12px; font-weight:600;">
								REF: INV-${projectId.slice(0,8).toUpperCase()}
							</p>
							<p style="font-size:12px; color:#6b7280;">
								DATE: ${new Date().toLocaleDateString('en-IN')}
							</p>
						</div>
					</div>


					<!-- BILL TO + PROJECT -->
					<div style="display:flex; justify-content:space-between; margin-bottom:70px;">
						<div style="width:48%;">
							<h4 style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#6b7280; margin-bottom:14px;">
								Bill To
							</h4>

							<p style="font-size:17px; font-weight:700; margin:0;">
								${customer?.customer_name || 'Valued Client'}
							</p>
							<p style="margin-top:6px; font-size:13px;">
								${customer?.email_id || project.client_email}
							</p>
							<p style="margin-top:4px; font-size:13px; color:#6b7280;">
								${customer?.phone_number || 'Site Address Linked to Project'}
							</p>
						</div>

						<div style="width:40%; text-align:right;">
							<h4 style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#6b7280; margin-bottom:14px;">
								Project Reference
							</h4>

							<p style="font-size:15px; font-weight:700; margin:0;">
								${project.project_name}
							</p>

							<p style="margin-top:6px; font-size:12px; font-weight:600; color:#4f46e5; text-transform:uppercase;">
								STATUS: ${project.current_phase}
							</p>
						</div>
					</div>


					<!-- TABLE -->
					<table style="width:100%; border-collapse:collapse; margin-bottom:60px;">

						<thead>
							<tr style="border-bottom:2px solid #111827;">
								<th style="padding:14px 8px; text-align:left; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#6b7280;">SL</th>
								<th style="padding:14px 8px; text-align:left; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#6b7280;">Service Description</th>
								<th style="padding:14px 8px; text-align:center; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#6b7280;">Qty</th>
								<th style="padding:14px 8px; text-align:right; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#6b7280;">Rate</th>
								<th style="padding:14px 8px; text-align:right; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#6b7280;">Total</th>
							</tr>
						</thead>

						<tbody>
							${artifacts.map((item, index) => `
								<tr style="border-bottom:1px solid #e5e7eb;">
									<td style="padding:22px 8px; font-size:13px; color:#6b7280;">
										${index + 1}
									</td>

									<td style="padding:22px 8px;">
										<div style="font-size:14px; font-weight:600; color:#111827;">
											${item.item_name}
										</div>
										<div style="font-size:12px; color:#6b7280; margin-top:6px;">
											${item.details || ''}
										</div>
									</td>

									<td style="padding:22px 8px; text-align:center; font-size:13px;">
										${item.quantity}
									</td>

									<td style="padding:22px 8px; text-align:right; font-size:13px;">
										₹${item.cost_per_item.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
									</td>

									<td style="padding:22px 8px; text-align:right; font-size:14px; font-weight:600;">
										₹${(item.quantity * item.cost_per_item).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
									</td>
								</tr>
							`).join('')}
						</tbody>
					</table>


					<!-- FOOTER AREA (UNCHANGED STRUCTURE) -->
					<div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:20px;">

						<!-- TERMS EXACT -->
						<div style="max-width:320px; font-size:10px; color:#6b7280; line-height:1.6;">
							<h4 style="color:#111827; font-weight:700; text-transform:uppercase; font-size:10px; margin-bottom:10px;">
								Terms & Notes
							</h4>
							<p>
								1. Please include Invoice Ref in all bank transfers.<br>
								2. This is a computer-generated document for client approval.
							</p>
						</div>

						<!-- TOTALS EXACT STRUCTURE -->
						<div style="min-width:300px;">

							<div style="display:flex; justify-content:space-between; padding:10px 0;">
								<span style="font-size:13px;">Subtotal:</span>
								<span style="font-size:13px; font-weight:600;">₹${formatCurrency(subTotal)}</span>
							</div>

							<div style="display:flex; justify-content:space-between; padding:8px 0;">
								<span style="font-size:13px; color:#dc2626;">
									Discount (${discountPercent}%):
								</span>
								<span style="font-size:13px; font-weight:600; color:#dc2626;">
									− ₹${formatCurrency(discountAmount)}
								</span>
							</div>

							<div style="display:flex; justify-content:space-between; padding:8px 0;">
								<span style="font-size:13px;">Grand Total:</span>
								<span style="font-size:13px; font-weight:600;">
									₹${formatCurrency(grandTotal)}
								</span>
							</div>

							<div style="display:flex; justify-content:space-between; padding:8px 0;">
								<span style="font-size:13px; color:#6b7280;">Round Off:</span>
								<span style="font-size:13px; font-weight:600; color:#6b7280;">
									${roundOffAmount >= 0 ? '+' : '−'} ₹${formatCurrency(Math.abs(roundOffAmount))}
								</span>
							</div>

							<div style="border-top:2px solid #111827; margin:18px 0;"></div>

							<div style="display:flex; justify-content:space-between; padding:10px 0;">
								<span style="font-size:16px; font-weight:800;">
									Net Amount Payable:
								</span>
								<span style="font-size:22px; font-weight:800;">
									₹${formatCurrency(roundedTotal)}
								</span>
							</div>

							<!-- SIGNATURE EXACT -->
							<div style="text-align:center; margin-top:30px;">
								<img id="inv-sig"
									 src="https://github.com/ranadeep-banik137/Nivas-Kunj-Query-Manager/blob/main/sig.png?raw=true"
									 style="height:100px; margin-bottom:5px; margin-left:60px; mix-blend-mode:multiply;">
								<div style="border-top:2px solid #111827; padding-top:10px; width:200px; margin:0 auto;">
									<p style="margin:0; font-size:12px; font-weight:700;">
										Authorized Signatory
									</p>
									<p style="margin:0; font-size:10px; color:#6b7280; font-weight:600;">
										Deepjoy Banik, CEO & Founder
									</p>
								</div>
							</div>

						</div>
					</div>

				</div>
				`;


			const logoImg = document.getElementById('inv-logo');
			const sigImg = document.getElementById('inv-sig');

			const waitImg = (img) => new Promise(res => {
				if (!img) return res();
				if (img.complete) res();
				else { img.onload = res; img.onerror = res; }
			});

			await Promise.all([waitImg(logoImg), waitImg(sigImg)]);

			window.print();
			printArea.innerHTML = '';
		}
