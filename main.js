jQuery(document).ready(function () {
	Date.prototype.format = function () {
		return (
			this.getFullYear() +
			'-' +
			this.strPad(this.getMonth() + 1) +
			'-' +
			this.strPad(this.getDate())
		);
	};

	Date.prototype.strPad = function (val) {
		if (val > 9) {
			return val.toString();
		}
		return '0' + val;
	};

	var Scheduler = function (options) {
		this.init(options);
	};
	jQuery.extend(Scheduler.prototype, {
		options: {
			api_url: '//user-api.simplybook.me',
			api_login: 'dtcbooking',
			api_key:
				'22477d708c3fc11e7fd59c07dd0c53816809f4d099704c0fac3a15ccf54b7a28',
		},
		client: null,
		anyUnitData: null,

		events: {},
		units: {},
		attachedUnits: [],

		eventId: 1,
		unitId: null,
		qty: 1,
		selectedUnitId: null,
		date: null,
		time: null,

		weekends: {},

		groupBookingsAllowed: false,
		multipleBookingsAllowed: false,

		batchId: null,

		additionalFields: [],

		init: function (options) {
			this.options = jQuery.extend({}, this.options, options);
			this.initClient();
			this.initElements();
			this.initEvents();
		},

		initClient: function () {
			var instance = this;

			var loginClient = new JSONRpcClient({
				url: this.getParam('api_url') + '/login',
				onerror: function (error) {
					instance.error(error);
				},
			});
			var token = loginClient.getToken(
				this.getParam('api_login'),
				this.getParam('api_key')
			);
			this.client = new JSONRpcClient({
				url: this.getParam('api_url'),
				headers: {
					'X-Company-Login': this.getParam('api_login'),
					'X-Token': token,
				},
				onerror: function (error) {
					instance.error(error);
				},
			});
		},

		initElements: function () {
			jQuery('#qty-element').hide();

			var instance = this;
			jQuery('#date').datepicker({
				startDate: new Date(),
				todayHighlight: true,
				format: 'yyyy-mm-dd',
				maxViewMode: 0,
				changeYear: false,
				changeMonth: false,
				beforeShowDay: function (date) {
					if (instance.weekends[date.format()] == true) {
						return { enabled: false };
					}
				},
			});

			this.client.getEventList(function (events) {
				instance.events = events;
				for (var id in events) {
					var event = events[id];
					jQuery('#event_id').append(
						jQuery(
							'<option value="' + event.id + '">' + event.name + '</option>'
						)
					);
					if (event.unit_map) {
						for (var unitId in event.unit_map) {
							instance.attachedUnits.push(unitId);
						}
					}
				}
			});

			this.client.getAnyUnitData(function (data) {
				instance.anyUnitData = data;
				instance.client.getUnitList(function (units) {
					instance.units = units;
					instance.setUnitList(units);
				});
			});
			this.client.getFirstWorkingDay(null, function (date) {
				instance.updateWorkCalendar(new Date(Date.parse(date)), function () {
					jQuery('#date').datepicker('update', date);
				});
			});
		},

		initEvents: function () {
			var instance = this;
			jQuery('#event_id').change(function (event, value) {
				instance.setEventId(jQuery(this).val());
			});
			jQuery('#unit_id').change(function () {
				instance.setUnitId(jQuery(this).val());
			});
			jQuery('#qty').change(function () {
				instance.setQty(jQuery(this).val());
			});
			jQuery('#date')
				.on('changeDate', function (event) {
					if (event.date) {
						instance.setDate(event.date.format());
					}
				})
				.on('changeMonth', function (event) {
					instance.updateWorkCalendar(event.date);
				});
			jQuery('.time-handler').change(function () {
				instance.loadStartTimeMatrix();
			});

			jQuery(document).on('click', '.time-item', function () {
				jQuery('.time-item.active').removeClass('active');
				jQuery(this).addClass('active');
				instance.setTime(jQuery(this).data('time'));

				if (instance.unitId == -1) {
					var unitArr = instance.client.getAvailableUnits(
						instance.eventId,
						instance.date + ' ' + instance.time,
						instance.qty
					);

					if (unitArr.length) {
						instance.selectedUnitId = unitArr[0];
					}
				}
			});

			jQuery('#book').click(function () {
				if (instance.selectedUnitId) {
					jQuery('#unit_id').val(instance.selectedUnitId);
				}

				instance.showClientInfo();
			});

			jQuery('#confirm').click(function () {
				instance.bookAppointment();
			});
		},

		setUnitList: function (units) {
			var oldVal = jQuery('#unit_id').val();

			jQuery('#unit_id option[value]').remove();
			if (this.anyUnitData) {
				jQuery('#unit_id').append(
					// -1 means any unit only for JS. We don't send it to server.
					jQuery('<option value="-1">' + this.anyUnitData.name + '</option>')
				);
			}
			for (var id in units) {
				var unit = units[id];
				jQuery('#unit_id').append(
					jQuery('<option value="' + unit.id + '">' + unit.name + '</option>')
				);
			}
			if (units[oldVal]) {
				jQuery('#unit_id').val(oldVal);
			} else {
				this.setUnitId('');
			}
		},

		setEventId: function (id) {
			this.eventId = id;
			var event = this.events[id];
			var list = {};

			if (event.unit_map) {
				for (var unitId in event.unit_map) {
					list[unitId] = this.units[unitId];
				}
			} else {
				for (var unitId in this.units) {
					if (jQuery.inArray(unitId, this.attachedUnits) == -1) {
						list[unitId] = this.units[unitId];
					}
				}
			}

			this.setUnitList(list);
		},

		setUnitId: function (id) {
			var instance = this;
			this.unitId = id;
			if (id && !this.date) {
				if (id == -1) {
					id = null;
				}
				this.client.getFirstWorkingDay(id, function (date) {
					instance.updateWorkCalendar(new Date(Date.parse(date)), function () {
						instance.setDate(date);
					});
				});
			}
		},

		updateWorkCalendar: function (date, callback) {
			if (!date) {
				date = jQuery('#date').datepicker('getDate');
			}
			var instance = this;
			var params = {
				unit_group_id: this.unitId,
				event_id: this.eventId,
			};
			this.client.getWorkCalendar(
				date.getFullYear(),
				date.getMonth() + 1,
				params,
				function (data) {
					instance.weekends = {};
					for (var dt in data) {
						if (data[dt].is_day_off == '1') {
							instance.weekends[dt] = true;
						}
					}
					jQuery('#date').datepicker('update');
					if (jQuery.type(callback) == 'function') {
						callback();
					}
				}
			);
		},

		setDate: function (date) {
			this.date = date;

			jQuery('#date').datepicker('update', date);
			this.loadStartTimeMatrix();
		},

		setTime: function (time) {
			this.time = time;
		},

		showClientInfo: function () {
			var instance = this;

			var unitId = this.unitId;
			if (unitId == -1) {
				unitId = null;
			}

			const datetime = `${this.date} ${this.time}`;

			this.client.calculateEndTime(
				datetime,
				this.eventId,
				this.unitId,
				function (res) {
					jQuery('#schedule').hide();
					jQuery('#client').show();

					jQuery('#unit_name').text(
						instance.units[jQuery('#unit_id').val()].name
					);

					const formattedLessonDate = dayjs(instance.date).format(
						'dddd DD MMMM YYYY'
					);
					const formattedLessonStartTime = dayjs(datetime).format('hh:mma');
					const formattedLessonEndTime = dayjs(res).format('hh:mma');
					const formattedTime = `${formattedLessonStartTime} - ${formattedLessonEndTime}`;

					jQuery('#lesson-date').text(formattedLessonDate);
					jQuery('#lesson-time').text(formattedTime);
				}
			);
		},

		bookAppointment: function () {
			if (this.validateClientData()) {
				var unitId = this.unitId;
				if (unitId == -1) {
					unitId = this.selectedUnitId;
				}
				if (!this.qty || this.qty < 1) {
					this.qty = 1;
				}
				var res = this.client.book(
					this.eventId,
					unitId,
					this.date,
					this.time,
					{
						name: jQuery('#name').val(),
						email: jQuery('#email').val(),
						phone: jQuery('#phone').val(),
					},
					this.qty
				);

				if (res.bookings) {
					alert('You successfully booked appointment.');
				}
			}
		},

		validateClientData: function () {
			jQuery('.has-error').removeClass('has-error');
			if (!jQuery('#name').val()) {
				jQuery('#name').parent().addClass('has-error');
			}
			if (!jQuery('#email').val()) {
				jQuery('#email').parent().addClass('has-error');
			}
			if (!jQuery('#phone').val()) {
				jQuery('#phone').parent().addClass('has-error');
			}
			if (!jQuery('.has-error').length) {
				return true;
			}
			return false;
		},

		loadStartTimeMatrix: function () {
			var instance = this;
			if (this.unitId && this.eventId && this.date) {
				jQuery('#time').empty();
				this.setTime(null);

				let date = this.date;
				let unitId = this.unitd == -1 ? null : this.unitId;
				let eventId = this.eventId;

				this.client.getStartTimeMatrix(
					date,
					date,
					eventId,
					unitId,
					this.qty,
					function (data) {
						var times = data[instance.date];
						if (times) {
							for (var i = 0; i < times.length; i++) {
								const startTime = times[i];
								const formattedStartTime = dayjs(`${date} ${startTime}`).format(
									'h:mm a'
								);
								const newDiv = `<div class="time-item" data-time="${startTime}" onclick="handleTimeItemClick()">${formattedStartTime}</div>`;
								jQuery('#time').append(newDiv);
							}
						}
					}
				);
			}
		},

		getParam: function (param, defaultValue) {
			if (jQuery.type(this.options[param]) != 'undefined') {
				return this.options[param];
			}
			return defaultValue;
		},

		error: function (error) {
			alert(error);
		},
	});

	var scheduler = new Scheduler();
});

const handleTimeItemClick = (divId) => {
	jQuery('#book').show();
};

$('.time-item').click(() => {
	console.log('clicked');

	$('.time-item').removeClass('active');
	$(this).toggleClass('active');
});

jQuery(document).ready(function () {
	$('th.prev').empty();
	$('th.next').empty();
	$('.datepicker-switch').addClass('datepicker-month');
});
