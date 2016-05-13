	(function() {

	var KB =  require('kb.js');
	var Info =  require('info.js');

	return {

	appProperties: {
      // This is available globally in your functions via this.appProperties.org_data
      // We need to be very careful here though. When setting this, it might be possible previous data or unrelated data is served.
      // This would also be shared among different instances of the app (per user) so if the agent switches tabs the data might be
      // in the object may no longer be relevant. One way to get around that would be to make sure when setting data to include the
      // current ticket_id in the object, so we can check that this.appProperties.ticket_id === this.ticket().id() before we trust the data.
		"org_data": {},
		"kb_info": {},
		"school_info":{},
		"bug_info":{},
		ticket_id: 0
    },

  //   requests: {
  //   	fetchOrganization: function() {
		// 	console.log("fetchOrganization ran");
		// 	return {
		// 		url:  '/api/v2/organizations/28110694.json', //hard coded for now
		// 		type: 'GET'
		// 	};
		// }
  //   },

	events: {

		// 'app.activated': function() {
		// 	this.activate_app();
		// },
		'app.activated': 'initialize',

		'fetchOrganization.done': 'fetchOrganizationDone',
		'fetchProblemTicketInfo.done': 'fetchProblemTicketInfoDone',

		'ticket.subject.changed' : 'subject_changed',
		'ticket.type.changed' : 'type_changed',
		'ticket.requester.id.changed' : 'requester_changed',
    'ticket.requester.email.changed': 'requester_changed',
		'ticket.custom_field_22930600.changed' : 'kb_id_changed', // kb_id_changed
		'ticket.custom_field_22790214.changed' : 'help_topic_changed', //help_topic_changed
		'ticket.custom_field_22222564.changed' : 'about_changed', // About Field

		'ticket.custom_field_22271994.changed' : 'product_module_changed', // Product Module field
		'ticket.custom_field_21744040.changed' : 'field_changed', // Product field
		'ticket.custom_field_30300358.changed' : 'bug_priority_changed', // bug priority field

		'click .save_button': 'chat_transcript_save',
		'ticket.save': 'ticketSaveHandler',
		'ticket.submit.done': 'ticketSaveDoneHandler',

		'createTicketRequest.always': 'createTicketRequestDone',
		'updateIncidentTicket.always': 'updateIncidentTicketDone',

		'click #phone_btn': function(event) {
			this.$('#phone_modal').modal({
				backdrop: true,
				keyboard: true
			});
		},


		'click #chat_transcript_btn': function(event) {
			this.$('#chat_transcript_modal').modal({
				backdrop: true,
				keyboard: true
			});
		},


    'click #phone_input': function(event) {
			this.$("#phone_input").select();
		},


    'click #create_bug_btn': function(event) {
			var ticket = this.ticket();
			var custom_fields = [{"id": 22222564, "value": "product_owner__bug"}];
			this.ajax('createTicketRequest', ticket, custom_fields);
		},


		'click #pop_test_toggle': function(event) {
			this.$('#kb_success_popover').popover('show');
			var app = this;
		},


	},

  requests: require('requests.js'),


	initialize: function(data) {
		var ticket = this.ticket();
		var sla_date_before = ticket.customField("custom_field_31407407");

		this.resetGlobals();

		// https://developer.zendesk.com/apps/docs/agent/interface

		// disable customer impact field from being changed by analyst
		this.ticketFields('custom_field_28972337').disable();
		// kb status
		this.ticketFields('custom_field_22953480').disable();
		// ticket source
		this.ticketFields('custom_field_27286948').disable();
		// chat dispatched
		this.ticketFields('custom_field_29482057').disable();
		// Sent to PSL Queue
		this.ticketFields('custom_field_32268947').disable();
		// Initial Assignee
		this.ticketFields('custom_field_32248228').disable();
		// Product dropdown is now set automatically
		this.ticketFields('custom_field_21744040').disable();
		// Product Sub Module 1
		this.ticketFields('custom_field_32341678').disable();
		// Product Sub Module 2
		this.ticketFields('custom_field_32363597').disable();




		// Disable PD Only fields for all groups except PSLs and PMs
		var group_array = ["Product Support Leads", "Product Managers"];
		if (!this.check_user_groups(group_array)) {
			// user is not a PSL or PM
			// disable the following:
			// Bug Review
			this.ticketFields('custom_field_30520367').hide();
			// Bug Priority
			this.ticketFields('custom_field_30300358').hide();
			// PD SLA
			this.ticketFields('custom_field_31407407').hide();
		}

		// Check if it's a new ticket or not
		var ticket_new;

	  if (ticket.status() === "new") {
			ticket_new = true;

			if (ticket.requester()) {
				this.get_organization_info();
			}
			else {
				this.switchTo('new', {
					user_id: this.currentUser().id(),
				});
			}

		}
		else {
			ticket_new = false;
			this.get_organization_info();
			if (ticket.type() === "incident") {
				this.get_problem_ticket_info();
			}
		}

  },


  'ticket.save': function() {
    return "The ticket wasn't saved!";
	},


  ticketSaveHandler: function() {
  	var ticket = this.ticket();
  	var type = ticket.type();
  	var about = ticket.customField("custom_field_22222564");

  	// KB Stuff
  	var no_kb_necessary = KB.no_kb_needed_test(ticket);
  	var has_kb_or_help = false;
		var kb_article_valid = KB.check_kb_id(ticket.customField("custom_field_22930600"));
		var help_topic_valid = KB.check_help_topic(ticket.customField("custom_field_22790214"));
		var internal_kb_rec = KB.internal_kb_recommended(ticket);

		if (kb_article_valid || help_topic_valid) {
			has_kb_or_help = true;
		}

		// Hold
		if (ticket.status() == "hold") {
			// Show Hold Status Modal when tickets don't have a hold status and are put on hold
			var hold_status = ticket.customField("custom_field_30584448");

			if (hold_status === "") {
	  			// This should only affect Support people
	  			var group_array = ["Support", "Product Support Leads", "Support Relationship Manager"];
	  			if (this.check_user_groups(group_array)) {
	    			this.$('#hold_modal').modal({
						backdrop: true,
						keyboard: true
					});
	  				return "The ticket wasn't saved! You need a Hold Status before submitting again.";
	  			}

  		}
		}
		else {
			// Remove Hold Status
			if ( type == "problem" && about == "product_owner__bug" || type == "incident") {
				// Don't remove the status if a problem ticket or it's an incident.
			} else {
				ticket.customField("custom_field_30584448", "");
			}
		}

		// Solved
		if (ticket.status() == "solved") {
			if (no_kb_necessary === false && has_kb_or_help === false && internal_kb_rec === false) {
	  			this.growl_kb_needed(ticket);
	  		}
		}

		this.generate_app_view();

  },


	ticketSaveDoneHandler: function() {
		this.get_problem_ticket_info();
		this.generate_app_view();
	},


// Ticket Field Changes --------------------

	product_module_changed: function () {
		// console.log("product module changed");
  	var ticket = this.ticket();
		var product_module = ticket.customField("custom_field_22271994");
		var product = ticket.customField("custom_field_21744040");
		var set_product, set_sub_1, set_sub_2;
		var split_modules;

		// console.log(product_module);
		split_modules = product_module.split("__");
		// console.log(split_modules);

		set_product = split_modules[0];
		set_sub_1 = split_modules[1];
		if (split_modules[2]) {
			set_sub_2 = split_modules[2];
		} else {
			set_sub_2 = "";
		}

		// Set the Product
		ticket.customField("custom_field_21744040", set_product);
		// Set the Sub Module 1
		ticket.customField("custom_field_32341678", set_sub_1);
		// Set the Sub Module 2
		ticket.customField("custom_field_32363597", set_sub_2);


// custom_field_32363597

	},

	bug_priority_changed: function () {
		// console.log("bug priority changed check groups");
		var group_array = ["Product Support Leads", "Product Managers"];
		if (this.check_user_groups(group_array)) {
			// console.log('current user is a PSL or PM');
			// Only modify if they are a PSL or PM
			this.set_pd_sla_date();
		} else {
			// console.log("disabling the pd sla field");
			this.ticketFields('custom_field_31407407').hide();
		}
		this.generate_app_view();
	},


  about_changed: function () {
  	this.type_changed();
  	this.generate_app_view();
  },


  type_changed: function () {
  	var ticket = this.ticket();
  	var type = ticket.type();
  	var about = ticket.customField("custom_field_22222564");

  	if (type == "incident") {
  		// Change the hold status
  		ticket.customField("custom_field_30584448", "hold_incident");
  	}
  	else if (type == "problem" && about == "product_owner__bug") {
  		ticket.customField("custom_field_30584448", "hold_bug");
  	}
  	else if (type == "problem" && about != "product_owner__bug") {
  		ticket.customField("custom_field_30584448", "");
  	}
  },


  check_user_groups: function(group_array) {
  	// This function returns true if user is one of the groups
		var current_user_groups = this.currentUser().groups();
		var group_names = [];
		var in_group;

		// Add each group name to an array called group_names
		_.each(current_user_groups, function(element, index, list){
			group_names.push(element.name());
		});

		_.each(group_array, function(element, index, list){
			if (_.contains(group_names, element)) {
				in_group = true;
				return in_group;
			}
		});

		if (in_group) {
			return true;
		}
	},


  growl_kb_needed: function(ticket) {
		// https://developer.zendesk.com/apps/docs/agent/services
		// https://developer.zendesk.com/apps/docs/agent/events#ticket.save-hook
		var msg  = "Hey now! You didn't include a KB article or Help Topic, and this ticket needs one. <a href='#/tickets/%@'>%@</a>";
		var life = parseInt(this.$('#life').val(), 10);
		life = isNaN(life) ? 10 : life;
		var ticket_id = ticket.id();
		services.notify(msg.fmt(ticket_id, ticket_id), 'error', life * 1000); // notice, alert, error
  },


  growl_hold_status_needed: function(ticket) {
		var msg  = "Hold your horses, you didn't include a Hold Status. <a href='#/tickets/%@'>%@</a>";
		var life = parseInt(this.$('#life').val(), 10);
		life = isNaN(life) ? 6 : life;
		var ticket_id = ticket.id();
		this.$('#hold_modal').modal({
			backdrop: true,
			keyboard: true
		});
		services.notify(msg.fmt(ticket_id, ticket_id), 'alert', life * 1000);
  },


  chat_transcript_save: function() {
		var ticket = this.ticket();
		var comment = this.comment();
		var modal_transcript = this.$('#chat_transcript').val();
		var full_comment;
		full_comment = '\r';
		full_comment += '---' + '\r';
		full_comment += '## Chat Transcript:' + '\r';
		var updated_transcript = this.format_chat_transcript();
		full_comment += updated_transcript;
		comment.appendMarkdown(full_comment);
		this.$('#chat_transcript_modal').modal('hide');
	},


	format_chat_transcript: function() {
  	var ticket = this.ticket();
  	var raw_chat_transcript = this.$('#chat_transcript').val();
		var pattern = new RegExp(/^(([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9] ?(AM|PM)) (\[(.*)\])/igm);
		var replacement = " \r\r\r*$1* **$5:**\r  \t";
		var fixed_chat_transcript = raw_chat_transcript.replace(pattern, replacement);
		return fixed_chat_transcript;
  },


	requester_changed: function() {
    // Requester changed - let's just regenerate everything including our handlebars
		if(this.ticket().requester()){
			this.get_organization_info();
		}
  },


  update_zd_custom_field: function(field_id, value) {
    return this.ticket().customField( helpers.fmt('custom_field_%@', field_id), value );
  },


  kb_id_changed: function () {
		this.generate_app_view();
	},


  help_topic_changed: function () {
		this.generate_app_view();
	},


	update_article_status: function () {
		var ticket = this.ticket();

		var help_topic_valid = KB.check_help_topic(ticket.customField("custom_field_22790214"));
		var kb_article_valid = KB.check_kb_id(ticket.customField("custom_field_22930600"));
		var no_kb_necessary = KB.no_kb_needed_test(ticket);

		this.appProperties.kb_info.kb_article_valid = kb_article_valid;
		this.appProperties.kb_info.help_topic_valid = help_topic_valid;
		var kb_status_before = ticket.customField("custom_field_22953480");
		var kb_status_after;
		this.appProperties.kb_info.show_kb_popup = false;

		if (help_topic_valid && kb_article_valid) {
			ticket.customField("custom_field_22953480", "kb_and_help_topic_attached");
		}
		else if (!help_topic_valid && kb_article_valid) {
			ticket.customField("custom_field_22953480", "kb_article_attached");
			kb_status_after = ticket.customField("custom_field_22953480");
		}
		else if (help_topic_valid && !kb_article_valid) {
			ticket.customField("custom_field_22953480", "help_topic_attached");
		}
		else {
			if(no_kb_necessary) {
				// TRUE = no KB is necessary
				ticket.customField("custom_field_22953480", "no_kb_necessary");
			}
			else {
				// FALSE  = needs KB
				ticket.customField("custom_field_22953480", "needs_kb_article");
			}

		}

		if (kb_status_before == "needs_kb_article" && kb_status_after != "needs_kb_article") {
			if (kb_article_valid || help_topic_valid)  {
				this.appProperties.kb_info.show_kb_popup = true;
			}
		}
	},


	field_changed: function () {
		this.get_organization_info();
		this.generate_app_view();
	},


	subject_changed: function () {
		this.generate_app_view();
	},


	set_pd_sla_date: function () {
		var ticket = this.ticket();
		var bug_priority = ticket.customField("custom_field_30300358");
		var sla_date = ticket.customField("custom_field_31407407");
		var new_sla_date;
		var today = new Date();

		switch (bug_priority) {
			case "0_critical_down":
				// Set SLA to 1 day from today
				today.setDate(today.getDate() + 1);
				new_sla_date = this.format_date_object(today);
				break;
			case "1_critical":
			// Set SLA to 30 days from today
				today.setDate(today.getDate() + 30);
				new_sla_date = this.format_date_object(today);
				break;
			case "2_high":
			// Set SLA to 90 days from today
				today.setDate(today.getDate() + 90);
				new_sla_date = this.format_date_object(today);
				break;
			case "3_medium":
				// Set SLA to 180 days from today
					today.setDate(today.getDate() + 180);
					new_sla_date = this.format_date_object(today);
					break;
			case "4_low":
			// Set SLA to 365 days from today to follow up later
				today.setDate(today.getDate() + 365);
				new_sla_date = this.format_date_object(today);
				break;
			case "5_cosmetic":
				// Set SLA to 365 days from today to follow up later
				today.setDate(today.getDate() + 365);
				new_sla_date = this.format_date_object(today);
				break;
			default:
				new_sla_date = sla_date;
		}

		// Make sure that the person cleared out the SLA Date field first.
		if (sla_date == null) {
			ticket.customField("custom_field_31407407", new_sla_date);
		}
	},


	format_date_object: function (date_object) {
		if (date_object !== null) {
			// console.log(date_object.getDate());
			// This changes it to MM/DD/YYYY
			var month = date_object.getMonth() + 1;
			var day = date_object.getDate();
			var year = date_object.getFullYear();
			var formatted_date = month + "/" + day + "/" + year;
			return formatted_date;
		}
	},


	fix_inverted_date_formatting: function (date_string) {
		var formatted_date;
		if (date_string !== "") {
			//original is YYYY-MM-DD
			var str = date_string.split("-");
			// This gets it to MM/DD/YYYY
			formatted_date = str[1] + "/" + str[2] + "/" + str[0];
		}
		else {
			formatted_date = "";
		}
		return formatted_date;
	},


	get_problem_ticket_info: function() {
		var ticket = this.ticket();
		if (ticket.customField('problem_id') > 0) {
			var problem_ticket = ticket.customField('problem_id');
			if (problem_ticket != null) {
				this.ajax('fetchProblemTicketInfo', problem_ticket);
			}
		}
		else {
			this.appProperties.bug_info.show = false;
		}
	},


	get_organization_info: function() {
		if(this.ticket().organization()){
			var organization = this.ticket().organization();
		 	// This response will be handled by fetchOrganizationDone if it's a success
		 	// It will then run generate_app_view
		 	this.ajax('fetchOrganization', organization.id());
		}
	},


	fetchOrganizationDone: function(data) {
		var org_data = data.organization;
  	this.appProperties.org_data = org_data;
  	this.appProperties.school_info = Info.fix_org_data(org_data);
  	this.generate_app_view();
  },


	fetchProblemTicketInfoDone: function(data) {
		var bug_info = {};
		var custom_fields = data.ticket.custom_fields;
		var bug_priority = _.find(custom_fields, function(item) { return item.id == 30300358; });
		var bug_sla_date = _.find(custom_fields, function(item) { return item.id == 31407407; });

		bug_info.priority = bug_priority.value;
		bug_info.sla_date = this.fix_inverted_date_formatting(bug_sla_date.value);

  	this.appProperties.bug_info = bug_info;
  	this.generate_app_view();
  },


	createTicketRequestDone: function(data){
			var incident_ticket_id = this.ticket().id();
			var problem_ticket_id = data.ticket.id;
			var msg  = "Created new ticket #<a href='#/tickets/%@'>%@</a>.";
			this.ajax('updateIncidentTicket', incident_ticket_id, problem_ticket_id);
			services.notify(msg.fmt(problem_ticket_id, problem_ticket_id), 'notice', 5000);

  },


	updateIncidentTicketDone: function(data){
		// var ticket_id = data.ticket.id;
		// var msg  = "Updated and linked incident ticket #<a href='#/tickets/%@'>%@</a>.";
		// services.notify(msg.fmt(ticket_id, ticket_id), 'notice', 5000);
	},


	make_chat_link: function() {
		var ticket = this.ticket();
		var subject = ticket.subject();
		var chat_base_URL = "https://k12supportform.myschoolapp.com/chat/";
		var user_id = this.currentUser().id();
		var requester = ticket.requester();
		var product = ticket.customField("custom_field_21744040");
		var chat_url = chat_base_URL;
		chat_url += "?requester=" + requester.email();
		chat_url += "&requester_name=" + requester.name();
		chat_url += "&assignee=" + user_id;
		chat_url += "&assignee_name=" + this.currentUser().name();

		if (subject != null) {
			chat_url += "&subject=" + ticket.subject();
		}
		if (product != null) {
			chat_url += "&product=" + product;
		}

		return chat_url;
	},


	check_if_in_group: function(group_array) {
		if (this.check_user_groups(group_array)) {
			return true;
		} else {
			return false;
		}
	},

	get_preferred_contact: function() {
		var ticket = this.ticket();
		var preferred_contact_method = ticket.customField("custom_field_29175937");
		if (preferred_contact_method == "email_preferred") {
			return "Email Me";
		} else if (preferred_contact_method == "phone_preferred") {
			return "Call Me";
		} else {
			return false;
		}

	},

	generate_app_view: function() {
		var ticket = this.ticket();
		var ticket_new = false;
		var app = this;
		var kb_info = this.appProperties.kb_info;
		var ticket_source = ticket.customField("custom_field_27286948");
		var is_chat_ticket = false;

		if (ticket.isNew()) {
			ticket_new = true;
		}

		if (ticket_source == "chat") {
			is_chat_ticket = true;
		}

		// Set the KB article status field
		this.update_article_status();

		// Make sure org data has been loaded before going forward
		if (typeof this.appProperties.org_data.id != 'undefined') {
			var authorized_contact = ticket.requester().customField("authorized_contact");
			if (this.appProperties.ticket_id === this.ticket().id()){
				// console.log("The ticket ID's match");
			} else {
				// console.log("Yikes. The ticket ID's don't match");
			}

			// Show the App layout
			this.switchTo('app', {
				ticket_new: ticket_new,
				kb_links: KB.make_kb_links(ticket),
				no_kb_necessary: KB.no_kb_needed_test(ticket),
				internal_kb_rec: KB.internal_kb_recommended(ticket),
				help_topic_valid: kb_info.help_topic_valid,
				kb_article_valid: kb_info.kb_article_valid,
				show_kb_popup: kb_info.show_kb_popup,
				is_chat_ticket: is_chat_ticket,
				user_is_psl: this.check_if_in_group(["Product Support Leads"]),
				bug_info: this.get_bug_info(),
				kb_article_number: ticket.customField("custom_field_22930600"),
				help_topic: ticket.customField("custom_field_22790214"),
				kb_quotes: this.kb_quotes(),
				organization: this.appProperties.school_info,
				school_urls: this.appProperties.school_info.organization_fields,
				preferred_contact_method: this.get_preferred_contact(),
				authorized_contact: authorized_contact,
				user_notes: ticket.requester().notes(),
				chat_url: this.make_chat_link(),
				user_id: this.currentUser().id(),
				requester: ticket.requester(),
			});
		} else {
			// Don't update the view yet!
			if (ticket.requester()) {
				this.switchTo('loading', {
					user_id: this.currentUser().id()
				});
			}
			else {
				// For new tickets
				this.switchTo('new', {
					user_id: this.currentUser().id(),
				});
			}
		}

	},


  resetGlobals: function(){
    var ticket_id = this.ticket().id();
    this.appProperties = {
			"org_data": {},
			"kb_info": {},
			"school_info":{},
			"bug_info":{},
			ticket_id: ticket_id
    };
  },


	get_bug_info: function() {
		var ticket = this.ticket();
		var type = ticket.type();
		var bug_priority = ticket.customField("custom_field_30300358");
		var sla_date_field = ticket.customField("custom_field_31407407");
		var sla_date_obj;
		var sla_date_as_str;

		if (!sla_date_field) {
			// Do nothing, it is blank/null
		} else {
			sla_date_obj = new Date(sla_date_field.to_s());
			sla_date_obj.setDate(sla_date_obj.getDate() + 1);
			sla_date_as_str = this.format_date_object(sla_date_obj);
		}


		// for (item in sla_date) {
			// console.log("property:" + item);
		// }
		// console.log(sla_date.to_s());
		// console.log(sla_date.strftime("%d-%m-%y"));

		var bug_info = {};
		bug_info.show = false;

		if (type === "problem" && bug_priority !== "") {
			bug_info.show = true;
			bug_info.priority = bug_priority;
			if (sla_date_field !== null) {
				bug_info.sla_date = sla_date_as_str;
			}
		}
		else if (type === "incident" && ticket.customField('problem_id') > 0) {
			// console.log(this.appProperties.ticket_id);
			bug_info = this.appProperties.bug_info;
			if (bug_info.priority) {
				bug_info.show = true;
			}
			else {
				bug_info.show = false;
			}
		}

		return bug_info;
	},


// ------------ KB Functions ---------------- //

	kb_quotes: function() {
		var kb_quotes = {};
		kb_quotes.kb_success = this.random_kb_success_quote();
		return kb_quotes;
	},


	random_kb_success_quote: function () {
		var quote_array = [];
		var quote = {};

		quote_array.push({
			text:"You're swell!",
			pic:this.assetURL("e-badpokerface.png")});

		quote_array.push({
			text:"Awww, thanks for adding that!",
			pic:this.assetURL("e-awthanks.png")});

		quote_array.push({
			text:"You make Jen smile every time you add a KB article.",
			pic:this.assetURL("e-content.png")});

		quote_array.push({
			text:"I don't always add a KB, but when I do, I'm about 10x cooler.",
			pic:this.assetURL("e-dosequis.png")});

		quote_array.push({
			text:"You just made Steve proud.",
			pic:this.assetURL("e-jobs.png")});

		quote_array.push({
			text:"A mi me gusta cuando añadas un KB.",
			pic:this.assetURL("e-megusta.png")});

		quote_array.push({
			text:"You're like a KB ninja!",
			pic:this.assetURL("e-ninja.png")});

		quote_array.push({
			text:"#boom (drop the mic)",
			pic:this.assetURL("e-boom.gif")});

		quote_array.push({
			text:"I get a little emotional when someone adds a KB.",
			pic:this.assetURL("e-yey.png")});

		quote_array.push({
			text:"Only cool people add a KB. #suave",
			pic:this.assetURL("e-caruso.png")});

		quote_array.push({
			text:"Way to go!",
			pic:this.assetURL("e-thumbs_up.png")});

		quote_array.push({
			text:"This article is Wookie approved.",
			pic:this.assetURL("e-chewy.png")});

		quote_array.push({
			text:"You have just wowed our customers!",
			pic:this.assetURL("e-boom.gif")});

		quote_array.push({
			text:"Cheers!",
			pic:this.assetURL("e-beer.png")});

		quote_array.push({
			text:"You have all the best words.",
			pic:this.assetURL("e-trump.png")});

		var random_number = Math.floor(Math.random() * quote_array.length);

		return quote_array[random_number];
	},

// ------------ END KB Functions ---------------- //


	};
}());
