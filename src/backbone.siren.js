(function (_, Backbone, undefined) {
    'use strict';


    /**
     *
     * @type {Object}
     * @private
     */
    var warn = function () {
        if (Backbone.Siren.settings.showWarnings && console) {
            console.warn.apply(console, arguments);
        }
    };


	/**
	 * Stores Siren objects in memory
	 *
	 * @constructor
	 */
	function Store() {
		this.data = {};
		this.requests = {};
	}


	Store.prototype = {

		/**
		 *
		 * @param {Backbone.Siren.Model|Backbone.Siren.Collection} sirenObj
		 * @return {Backbone.Siren.Model}
		 */
		add: function (sirenObj) {
			var self = this;

			if (BbSiren.isCollection(sirenObj)) {
				sirenObj.each(function (sirenModel) {
					self.add(sirenModel);
				});
			}

			this.data[sirenObj.url()] = sirenObj;
			return sirenObj;
		}


		/**
		 *
		 * @param {String} sirenObjOrUrl
		 * @return {Backbone.Siren.Model}
		 */
		, get: function (sirenObjOrUrl) {
			return this.data[typeof sirenObjOrUrl == 'object'? getUrl(sirenObjOrUrl): sirenObjOrUrl];
		}


		/**
		 * Filters Siren objects by their index value (aka their self-url)
		 *
		 * @param regex
		 * @returns {Array}
		 */
		, filter: function (regex) {
			return _.filter(this.data, function (val, key) {
				return regex.test(key);
			});
		}


		/**
		 *
		 * @param {Backbone.Siren.Model|Object|String} ModelOrSirenObjOrUrl
		 * @return {Boolean}
		 */
		, exists: function (ModelOrSirenObjOrUrl) {
			return !!this.get((ModelOrSirenObjOrUrl instanceof Backbone.Siren.Model)
				? ModelOrSirenObjOrUrl.url()
				: ModelOrSirenObjOrUrl);
		}


		/**
		 *
		 * @param url
		 * @param request
		 * @returns {Promise}
		 */
		, addRequest: function (url, request) {
			this.requests[url] = request;
			return request;
		}


		/**
		 *
		 * @param url
		 * @returns {Promise}
		 */
		, getRequest: function (url) {
			return this.requests[url];
		}
	};


    /**
     *
     * @param {Backbone.Siren.Model|Backbone.Siren.Collection} parent
     * @param actionData
     * @constructor
     */
    function Action(actionData, parent) {
	    var someModel;

	    _.extend(this, {'class': [], method: 'GET', type: 'application/x-www-form-urlencoded'}, actionData);

	    // WIP - Batch
	    // It's implied that an empty fields array means we are using field definitions as provided by sub-entities
	    // I'm calling this "nested batch".  No support yet for "inline batch"
	    if (_.indexOf(this['class'], 'batch') > -1 && _.isEmpty(this.fields)) {
		    someModel = parent.first();
		    if (someModel) {
			    this.fields = someModel.getActionByName(this.name).fields;
		    }
	    }

	    this.parent = parent;
    }


    Action.prototype = {

	    /**
	     *
	     * @param {String} classname
	     * @returns {boolean}
	     */
	    hasClass: function (classname) {
		    return _.indexOf(this['class'], classname) > -1;
	    }


        /**
         *
         * @param {String} name
         * @return {*}
         */
        , getFieldByName: function (name) {
            return _.find(this.fields, function (field) {
                return field.name == name;
            });
        }


	    /**
	     * Gets the secureKeys model.
	     *
	     * 95% of Models will not use secureKeys, so no need to have the secureKeys model added to all actions.
	     *
	     * Technically, secureKeys aren't all that inherently "secure", it's a bucket for temporarily storing security
	     * information in one spot so you can easily clear them out as soon as they are no longer needed.
	     *
	     * @returns {Backbone.Model}
	     */
	    , getSecureKeys: function () {
		    var secureKeys = this.secureKeys;
		    if (secureKeys) {
			    return secureKeys;
		    }

		    this.secureKeys = new Backbone.Model();
		    return this.secureKeys;
	    }


	    /**
	     *
	     * @param {String} name
	     * @param {String} value
	     */
	    , setSecureKey: function (name, value) {
		    var secureKeys = this.getSecureKeys();
		    secureKeys.set(name, value);
	    }


	    /**
	     *
	     * @param {String}
	     * @returns {*}
	     */
	    , getSecureKey: function (name) {
		    var secureKeys = this.secureKeys;

		    if (secureKeys) {
			    return secureKeys.get(name);
		    }
	    }


	    /**
	     * Clears all secure keys.
	     * We don't want "secure keys" floating around they should be cleared as soon as they are no longer needed
	     *
	     */
	    , clearSecureKey: function (name) {
		    return this.getSecureKeys().unset(name);
	    }


	    /**
	     * Clears all secure keys.
	     * We don't want "secure keys" floating around they should be cleared as soon as they are no longer needed
	     *
	     */
	    , clearSecureKeys: function () {
		    return this.getSecureKeys().clear();
	    }


        /**
         *
         * @param {Object} options
         * @return {$.Deferred|undefined}
         */
        , execute: function (options) {
            options = options || {};

            var actionModel, jqXhr
            , attributes = options.attributes// So you can pass in properties that do not exist in the parent.
            , actionName = this.name
            , parent = this.parent
            , presets = {
                url: this.href
                , actionName: actionName
                , success: function (model, resp, options) {
                    parent.trigger('sync:' + actionName, model, resp, options);
			        if (parent instanceof Backbone.Model) {
				        parent.attributes = {};
						parent.set(actionModel.attributes);
			        } else {
				        // Parent is assumed to be a collection
				        parent.set(actionModel.models);
			        }
                }
                , error: function (model, xhr, options) {
                    parent.trigger('error:' + actionName, model, xhr, options);
                }
            };

            delete options.attributes;

            if (! parent) {
                return;
            }

            if (this.method) {
                presets.type  = this.method;
            }

            if (this.type) {
                presets.contentType = this.type;
            }

		    if (presets.type == 'PATCH') {
			    options.patch = true;
		    }

		    // Create a temporary clone that will house all our actions related properties
		    // We do this because Backbone will override our model with the response from the server
		    // @todo we probably want something smarter so that we can update the model but still mitigate funky stuff from happening in the View.
		    if (parent instanceof Backbone.Model) {
			    actionModel = parent.clone();
			    actionModel._data = parent._data;
			    actionModel._actions = parent._actions;

			    actionModel.on('request', function (model, jqXhr, options) {
				    parent.trigger('request', model, jqXhr, options);
				    parent.trigger('request:' + actionName, model, jqXhr, options);
			    });
		    } else {
			    // parent is a collection, no need to clone it.
			    actionModel = parent;

			    parent.on('request', function (model, jqXhr, options) {
				    parent.trigger('request:' + actionName, model, jqXhr, options);
			    });
		    }

            options = _.extend(presets, options);
            attributes = _.extend(parent.toJSON({actionName: this.name}), attributes);

		    // Note that .save() can return false in the case of failed validation.
		    jqXhr = actionModel.save(attributes, options);

		    // Transfer any validation errors back onto the "original" model or collection.
		    parent.validationError = actionModel.validationError;

		    return jqXhr;
        }
    };


    /**
     *
     * @static
     * @param name
     * @return {String}
     */
    function toCamelCase(name) {
        return name.replace(/(\-[a-z])/g, function(match){return match.toUpperCase().replace('-','');});
    }


    /**
     *
     * @static
     * @param entity
     * @return {String}
     */
    function getUrl(entity) {
        var link, url;

	    if (!entity) {
		    return;
	    }

        if (entity.href) {
            url = entity.href;
        } else if (entity.links) {
            link = _.filter(entity.links, function (link) {
                return !!(link.rel && _.filter(link.rel, function (relType) {
                    return relType == 'self';
                }).length);
            })[0];

            if (link) {
                url = link.href;
            }
        } else {
            warn('Missing href or "self" link');
            url = '';
        }

        return url;
    }


    /**
     * Access to the representation's "self" url, or its "href" if there is one.
     *
     * @return {String}
     */
    function url() {
	    return getUrl(this._data);
    }


    /**
     *
     * @static
     * @param {Object} sirenObj Can be a siren entity or siren action object
     * @return {Array}
     */
    function getClassNames(sirenObj) {
        return sirenObj['class'] || [];
    }


    /**
     *
     * @static
     * @param {Array} entities
     * @param {Object} filters
     * @return {Array}
     */
    function filter(entities, filters) {
        return _.filter(entities, function (entity) {
            return hasProperties(entity, filters);
        });
    }


    /**
     *
     * @param {Backbone.Siren.Model|Backbone.Siren.Collection} bbSiren
     * @param {Object} filters
     * @return {Boolean}
     */
    function hasProperties(bbSiren, filters) {
        var _hasProperties = true;

        if (filters.className) {
            _hasProperties = bbSiren.hasClass(filters.className);
        }

        if (filters.rel) {
            _hasProperties = bbSiren.hasRel(filters.rel);
        }

        return _hasProperties;
    }


    /**
     *
     * @param {Object} action
     * @param {Object} filters
     * @return {Boolean}
     */
    function actionHasProperties(action, filters) {
        var hasProperties = true;

        if (filters.className) {
            hasProperties = _hasClass(action, filters.className);
        }

        if (filters.name) {
            hasProperties = action.name == filters.name;
        }

        return hasProperties;
    }


    /**
     *
     * @static
     * @param sirenObj
     * @param className
     * @return {Boolean}
     */
    function _hasClass(sirenObj, className) {
        return _.indexOf(getClassNames(sirenObj), className) > -1;
    }


    /**
     *
     * @param className
     * @return {Boolean}
     */
    function hasClass(className) {
        return _hasClass(this._data, className);
    }


    /**
     *
     * @param rel
     * @return {Boolean}
     */
    function hasRel(rel) {
        return _.indexOf(this.rels(), rel) > -1;
    }


    /**
     * Accesses the "class" property of the Siren Object
     *
     * @return {Array}
     */
    function classes() {
        return getClassNames(this._data);
    }


    /**
     * @todo Haven't had many use-cases yet for links.
     * As the use-cases arise, this method should be re-thought
     *
     * @param {String} rel
     * @return {Array}
     */
    function links(rel) {
        var _links = this._data.links;

        if (rel) {
            _links = _.filter(_links, function (link) {
                return _.indexOf(link.rel, rel) > -1;
            });
        }

        return _links || [];
    }


    /**
     * Resolves the first link that matches the given rel
     *
     * @todo This only works with rel links that are requests to the API.
     * There will be times when a rel points to a resource outside of the API and that needs to be thought through
     * @todo This method leaves much to be desired and should be refactored.
     *
     * @param {String} rel
     * @return {Promise}
     */
    function request(rel) {
        // Similar to .links() only it only gives us the first "rel" match
        var link = _.find(this._data.links, function (link) {
		    return _.indexOf(link.rel, rel) > -1;
	     });

	    if (! link) {
		    return;
	    }

        return Backbone.Siren.resolve(link.href);
    }


	/**
	 * @TODO fix
	 *  - currently, collections do not get cached by the store
	 *
	 * Wrapper for .fetch(), adds the following:
	 * 1) Checks the local store
	 * 2) The deferred is resolved with the parsed Siren object
	 * 3) "sync" event is only fired once
	 *
	 * @param {Object} options
	 */
	function resolve(options) {
		options = options || {};

		var deferred = new $.Deferred();

		this.once('sync', function (bbSiren) {
			deferred.resolve(bbSiren);
		});

		if (options.forceFetch || !this.isLinked) {
			this.fetch(options);
		} else if (! _.isEmpty(this._data)) {
			// Its already been hydrated
			deferred.resolve(this);
		} else if (options.url) {
			// This option allows us to defer hydration of our model or collection with the url provided
			// Very much like .fetch() only it adds support for chaining nested entities

			var self = this
			, chain = Backbone.Siren.parseChain(options.url)
			, finalEntity = chain.pop();

			delete options.url;

			if (finalEntity && ! chain.length) {
				this.resolve(_.extend(_.clone(options), {url: finalEntity, forceFetch: true})).done(function (bbSiren) {
					// Resolve the original deferred object.
					deferred.resolve(bbSiren);
				});
			} else if (finalEntity) {
				Backbone.Siren.resolve(chain, options).done(function (model) {
					self.resolve(_.extend(_.clone(options), {url: model.get(finalEntity).url(), forceFetch: true})).done(function (bbSiren) {
						// Resolve the original deferred object.
						deferred.resolve(bbSiren);
					});
				});
			}
		}

		return deferred.promise();
	}


	/**
	 * Goes down the given chain and resolves all entities, relative to the current entity.
	 *
	 * @param chain
	 * @param options
	 * @returns {Promise}
	 */
    function resolveChain(chain, options) {
        return nestedResolve(this, Backbone.Siren.parseChain(chain), new $.Deferred(), options);
    }


    /**
     *
     * @return {Array}
     */
    function getRel(sirenObj) {
        return sirenObj.rel || [];
    }


    /**
     *
     * @static
     * @param sirenObj
     * @return {String}
     */
    function getRelAsName(sirenObj) {
        var name;

        _.find(getRel(sirenObj), function(rel) {
            name = /name:(.*)/.exec(rel);
            return name;
        });

        return _.last(name);
    }


    /**
     *
     * @static
     * @param sirenObj
     * @return {String}
     */
    function getName(sirenObj) {
        return sirenObj.name || getRelAsName(sirenObj);
    }


    /**
     *
     * @param filters
     * @return {*|Array}
     */
    function actions(filters) {
        var _actions = this._actions;

        if (filters) {
            _actions = _.filter(_actions, function (action) {
                return actionHasProperties(action, filters);
            });
        }
        return _actions;
    }


    /**
     *
     * @param {String} name
     * @return {Object|undefined}
     */
    function getActionByName(name) {
        return _.find(this._actions, function (action) {
            return action.name == name;
        });
    }


    /**
     * Access to the representation's "title"
     *
     * @return {String}
     */
    function title() {
        return this._data.title;
    }


    /**
     *
     * @return {Array|undefined}
     */
    function parseActions() {
        var self = this
        , _actions = [];

	    if (! this._data) {
		    return;
	    }

        _.each(this._data.actions, function (action) {
            var bbSirenAction = new Backbone.Siren.Action(action, self);

            _actions.push(bbSirenAction);

            if (action.name) {
                self[toCamelCase(action.name)] = _.bind(bbSirenAction.execute, bbSirenAction);
            } else {
                warn('Action is missing a name, unable to add top level method', action);
            }
        });

        self._actions = _actions;
        return _actions;
    }


    function nestedResolve(bbSiren, chain, deferred, options) {
        options = options || {};

	    if (! options.store) {
		    options.store = bbSiren.store;
	    }

        var entityName = chain.shift();
        var subEntity = bbSiren.get(entityName);
        if (! subEntity) {
            throw 'The entity you are looking for, "' + entityName + '" is not a sub-entity at ' + bbSiren.url() + '.';
        }

        options.deferred = deferred;
        return Backbone.Siren.resolve(subEntity.url() + '#' + chain.join('#'), options);
    }


    /**
     *
     * @param {Backbone.Siren.Model} bbSiren
     * @param {Array} chain
     * @param {Object} deferred
     * @param {Object} options
     */
    function handleRootRequestSuccess(bbSiren, chain, deferred, options) {
        if (_.isEmpty(chain)) {
            deferred.resolve(bbSiren);
        } else {
            nestedResolve(bbSiren, chain, deferred, options);
        }
    }


	var BbSiren = Backbone.Siren = function (apiRoot, options) {
		this.store = new Backbone.Siren.Store();
		this.init(apiRoot, options);
	};


	_.extend(BbSiren, {
        settings: {
            showWarnings: true
        }
        , warn: warn


		/**
		 *
		 * @param json
		 * @returns {Boolean}
		 */
		, isCollection: function (json) {
			return _hasClass(json, 'collection');
		}

		, Store: Store
        , Action: Action


        /**
         * Creates a Backbone.Siren model, collection, or error from a Siren object
         *
         * @param {Object} entity
         * @returns {Backbone.Siren.Model|Backbone.Siren.Collection|Backbone.Siren.Error}
         */
        , parse: function (entity, store) {
            var bbSiren;

            if (_hasClass(entity, 'collection')) {
                bbSiren = new Backbone.Siren.Collection(entity, {store: store});
            } else if (_hasClass(entity, 'error')) {
                // @todo how should we represent errors?  For now, treat them as regular Models...
                bbSiren = new Backbone.Siren.Model(entity, {store: store});
            } else {
                bbSiren = new Backbone.Siren.Model(entity, {store: store});
            }

            return bbSiren;
        }


        /**
         *
         * @param {String} url
         */
        , ajax: function (url, options) {
            options = _.extend({url: url, dataType: 'json'}, options);
            return Backbone.ajax(options);
        }


	    /**
	     *
	     *
	     */
	    , parseChain: function (chain) {
		    if (typeof chain == 'string') {
			    chain = chain.replace(/^#|#$/, '').split('#');
		    }

		    return chain;
	    }


        /**
         * @TODO Dire need of cleanup
         *
         * We cache bbSiren models in the store, we also cache requests to the api.
         * Caching the requests allows us asynchronous access to ALL requests not just those that have resolved.
         * This implementation needs to be revisited.  Maybe more of this logic can be moved over to the store.
         *
         * @param {String} url
         * @param {Object} options
         * @param {Object} options.store - store instance @todo remove the need to have this parameter
         */
        , resolve: function resolve(url, options) {
            options = options || {};

            var store, state, deferred, storedPromise, bbSiren
            , chain = Backbone.Siren.parseChain(url)
            , rootUrl = chain.shift()
            , chainedDeferred = options.deferred;

			// @todo temporary hack while we rewrite the store api.
			if (options.store) {
				store = options.store;
			} else {
				store = {
					getRequest: function () { /* no-op */ }
					, addRequest: function () { /* no-op */ }
					, get: function () { /* no-op */ }
				};
			}

            storedPromise = store.getRequest(rootUrl);
            if (storedPromise) {
                state = storedPromise.state();
            }

            // The request has already been made and we are ok to use it.
            if (_.isEmpty(chain) && ((state == 'resolved' && !options.forceFetch) || state == 'pending')) {
                if (chainedDeferred) {
                    return storedPromise.done(function (bbSiren) {
                        chainedDeferred.resolve(bbSiren);
                    });
                } else {
                    return storedPromise;
                }
            }

            // We need a deferred object to track the final result of our request (bc it can be chained)
            if (! chainedDeferred) {
                chainedDeferred = new $.Deferred();
            }

            if (state == 'pending') {
                // Check for a pending request, piggy-back on it's promise if it exists.

                storedPromise.done(function (bbSiren) {
                    nestedResolve(bbSiren, chain, chainedDeferred, options);
                });
            } else {
                if (options.forceFetch || !(bbSiren = store.get(rootUrl))) { // Assign value to bbSiren
                    // By creating our own Deferred() we can map standard responses to bbSiren error models along each step of the chain
                    deferred = new $.Deferred();
                    store.addRequest(rootUrl, deferred.promise());
                    Backbone.Siren.ajax(rootUrl, options)
                        .done(function (entity) {
                            var bbSiren = Backbone.Siren.parse(entity);
                            deferred.resolve(bbSiren);
                            handleRootRequestSuccess(bbSiren, chain, chainedDeferred, options);
                        })
                        .fail(function (jqXhr) {
                            var entity, bbSiren;

		                    try {
			                    entity = JSON.parse(jqXhr.responseText);
		                    } catch (exception) {
			                    entity = {};
		                    }

		                    bbSiren = Backbone.Siren.parse(entity);
                            deferred.reject(bbSiren, jqXhr);
                            chainedDeferred.reject(bbSiren, jqXhr);
                        });
                } else {
                    // Use the stored bbSiren object
                    handleRootRequestSuccess(bbSiren, chain, chainedDeferred, options);
                }
            }

            return chainedDeferred.promise();
        }

        , Model: Backbone.Model.extend({

            url: url
            , classes: classes
            , hasClass: hasClass
            , hasRel: hasRel
            , title: title
            , actions: actions
            , links: links
            , getActionByName: getActionByName
            , parseActions: parseActions
            , request: request
		    , resolve: resolve
            , resolveChain: resolveChain


            /**
             *
             * @param {Object} sirenObj
             * @param {Object} options
             */
            , resolveEntities: function (options) {
                var self = this
                , resolvedEntities = [];

                _.each(this._data.entities, function(entity) {
                    resolvedEntities.push(self.resolveEntity(entity, options));
                });

                return $.when(resolvedEntities).done(function () {
                    self.trigger('resolve', self);
                });
            }


            /**
             * @todo this is a mess
             *
             * @param {Object} entity
             * @param {Object} options
             * @returns {$.Deferred}
             */
            , resolveEntity: function (entity, options) {
                options = options || {};

                var bbSiren, bbSirenPromise
                , self = this
                , deferred = new $.Deferred();

                if ((entity.href && options.autoFetch == 'linked') || options.autoFetch == 'all') {
                    Backbone.Siren.resolve(getUrl(entity), options)
                        .done(function (bbSiren) {
                            deferred.resolve(self.setEntity(bbSiren, getRel(entity), getName(entity)));
                        });
                } else {
                    bbSiren = Backbone.Siren.parse(entity, options.store);
                    bbSirenPromise = deferred.resolve(this.setEntity(bbSiren, getRel(entity), getName(entity)));
                }

                return bbSirenPromise;
            }


            /**
             *
             * @param {Backbone.Siren.Model} bbSiren
             * @param {Array} rel
             * @param {String} name
             * @return {Backbone.Siren.Model|Backbone.Siren.Collection|Backbone.Model.Error}
             */
            , setEntity: function (bbSiren, rel, name) {
                var entityItem = {
                    rel: rel
                    , entity: bbSiren
                };

                if (name) {
                    this.set(name, bbSiren);
                    entityItem.name = name;
                }
                this._entities.push(entityItem);

                return bbSiren;
            }





            /**
             * http://backbonejs.org/#Model-parse
             *
             * @param {Object} json
             */
            , parse: function (json, options) {
                this._data = json; // Stores the entire siren object in raw json
                this._entities = [];
				this.isLinked = json.links && !json.href;

				this.resolveEntities(options);

				if (options.store) {
					options.store.add(this);
				}

                return json.properties;
            }


            /**
             * http://backbonejs.org/#Model-toJSON
             *
             * @param {Object} options
             */
            , toJSON: function (options) {
                var action
	            , json = {}
	            , self = this;

                if (options && options.actionName) {
                    action = this.getActionByName(options.actionName);
                }

			    if (action) {
                    _.each(action.fields, function (field) {
                        var val = self.get(field.name);

                        json[field.name] = (val instanceof Backbone.Siren.Model || (val instanceof Backbone.Siren.Collection))
                            ? val.toJSON({actionName: field.action})
                            : val;
                    });
                } else {
                    _.each(this.attributes, function (val, name) {
                        json[name] = (val instanceof Backbone.Siren.Model) || (val instanceof Backbone.Siren.Collection)
                            ? val.toJSON(options)
                            : val;
                    });
                }

                return json;
            }


            /**
             * Filters the entity's properties and returns only sub-entities
             *
             * @return {Array}
             */
            , entities: function (filters) {
                var entities = _.map(this._entities, function (entityItem){
                    return entityItem.entity;
                });

                if (filters) {
                    entities = filter(entities, filters);
                }

                return entities;
            }


		    /**
		     * Not feeling great about overriding the default implementation of .isNew(), but some non-new models may not have an id.
		     * Thus, a better indicator (at least for now) of whether a model is new might be if it has a url or not.
		     *
		     * @returns {boolean}
		     */
		    , isNew: function () {
			    return !this.url();
		    }


            /**
             * http://backbonejs.org/#Model-constructor
             *
             * @param {Object} attributes
             * @param {Object} options
             */
            , constructor: function (sirenObj, options) {
                options = options || {};
                options.parse = true; // Force "parse" to be called on instantiation: http://stackoverflow.com/questions/11068989/backbone-js-using-parse-without-calling-fetch/14950519#14950519

                Backbone.Model.call(this, sirenObj, options);
			    this.parseActions();
            }

        })


        , Collection: Backbone.Collection.extend({
            url: url
            , classes: classes
            , hasClass: hasClass
            , hasRel: hasRel
            , title: title
            , links: links
            , actions: actions
            , getActionByName: getActionByName
            , parseActions: parseActions
            , request: request
		    , resolve: resolve
            , resolveChain: resolveChain


            /**
             *
             * @param {Function|Object} arg
             * @return {Array}
             */
            , filter: function (arg) {
                if (typeof arg ==  'function') {
                    return _.filter(this.models, arg); // @todo still needs a fix to pass along the entire "arguments" array (so you can also pass "first" as the 3rd arg)
                } else {
	                // @todo also probably needs to be "this.models" instead of "this" but no time to test right now
	                // @todo even more importantly, however, this logic needs to be @deprecated as it duplicates .where()
                    return filter(this, arg);
                }
            }


            /**
             * http://backbonejs.org/#Collection-parse
             *
             * @param {Object} sirenObj
             */
            , parse: function (sirenObj) {
                this._data = sirenObj; // Store the entire siren object in raw json
                this._meta = sirenObj.properties || {};

                var models = [];
                _.each(sirenObj.entities, function (entity) {
                    models.push(new Backbone.Siren.Model(entity));
                });

                return models;
            }


            /**
             * Unlike Models, collections don't have attributes.
             * However, there are times we need to store "meta" data about the collection such as
             * the paging "offset".
             *
             * @param {*} prop
             * @param {*} value
             * @return {Object}
             */
            , meta: function (name) {
                return this._meta[name];
            }


		    /**
		     * Overrides the default implementation so that we can append each model's "id"
		     *
		     * @param {Object} options
		     * @returns {Object}
		     */
		    , toJSON: function (options) {
			    options  = options || {};

//			    if (! options.isNestedBatch) { // @todo WIP
//				    delete options.actionName;
//			    }

			    return this.map(function (model){
				    var jsonObj = model.toJSON(options);
				    if (options.actionName) {
					    jsonObj.id = model.id;
				    }

				    return jsonObj;
			    });
		    }


		    /**
		     * A Collection can only do POST, or GET actions.
		     *
		     * Ex:
		     * POST a new resource
		     * POST batch action (including deletion of many resources)
		     * GET many resources
		     *
		     * @param {Object} attrs
		     * @param {Object} options
		     */
		    , save: function(attrs, options) {
			    options = _.extend({validate: true}, options);

			    if (this._validate) {
					this._validate(attrs, options);
			    }

			    // After a successful server-side save, the client is (optionally)
			    // updated with the server-side state.
			    if (options.parse === undefined) {
				    options.parse = true;
			    }

			    return  this.sync('create', this, options);
		    }


            /**
             * http://backbonejs.org/#Collection-constructor
             *
             * @param {Object} sirenObj
             * @param {Object} options
             */
            , constructor: function (sirenObj, options) {
                options = options || {};
                options.parse = true; // Force "parse" to be called on instantiation: http://stackoverflow.com/questions/11068989/backbone-js-using-parse-without-calling-fetch/14950519#14950519

                Backbone.Collection.call(this, sirenObj, options);
			    this.parseActions();
            }
        })
    });


	BbSiren.prototype = {

		/**
		 *
		 *
		 * @param apiRoot
		 * @param options
		 */
		init: function (apiRoot, options) {
			this.apiRoot = apiRoot;
			this.settings = options;
		}


		/**
		 *
		 * @param entityName
		 */
		, resolve: function (entityName) {
			var self = this;

			return BbSiren.resolve(this.apiRoot + '/' + entityName, {store: this.store})
				.done(function (json) {
					self.parse(json);
				});
		}


		/**
		 *
		 * @param {JSON} json
		 */
		, parse: function (json) {
			return BbSiren.parse(json);
		}
	};

}(_, Backbone));
