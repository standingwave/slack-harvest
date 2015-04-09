/*jshint node: true*/
'use strict';

var interactiveSession = require('./lib/user_session.js'),
    resolverConstructor = require('./lib/resolver').resolver,
    resolver = new resolverConstructor(interactiveSession.getDefault()),
    tools = require('./../tools'),
    _ = require('lodash'),
    timerParser = require('./../timer'),
    harvest = require('./../harvest')('default'),
    stepPrototype = require('./lib/step_prototype.js');
    
    /**
     * Applies step prototype to given step provider 
     * and returns it back
     * 
     * @param   {Object}    stepProvider
     * @returns {Object}
     */
    function stepFactory (stepProvider)
    {
        stepProvider.prototype = stepPrototype;
        return stepProvider;
    }

    // Step 1 provider
    resolver.addStepProvider(stepFactory({
        
        postStepActionProviders : {
            status : {
                execute : function (step, callback) {
                    var userId = step.getParam('userId');
                    interactiveSession
                                .getDefault()
                                .clear(userId)
                    ;
                    callback();
                },
                prepareStep : function (step)
                {
                    return null;
                }
            },
            stop : {
                prepareStep : function (step)
                {
                    return null;
                },
                
                execute : function (step, callback)
                {
                    var entry = timerParser.filterCurrentEntry(step.getParam('entries').day_entries),
                        userId = step.getParam('userId');
                
                    if (entry === null) {
                        step.addParam('stopError', 'Currently you have no running tasks.');
                        interactiveSession
                                .getDefault()
                                .clear(userId)
                        ;

                        callback();
                    } else {
                        step.addParam('entry', entry);
                        harvest.toggle(userId, entry.id, function (err, result) {
                            if (err !== null) {
                                step.addParam('stopError', 'An error occured, please try again later.');
                            }
                            interactiveSession
                                    .getDefault()
                                    .clear(userId)
                            ;
                            
                            callback();
                        });
                    }
                }
            }
        },
        
        viewsProviders : {
            status : {
                getView : function (step) 
                {
                    var entry = timerParser.filterCurrentEntry(step.getParam('entries').day_entries);
                    if (entry !== null) {
                        return  [
                            'You are currently working on \n',
                            entry.client + ' - ' + entry.project + ' - ' + entry.task 
                        ].join('\n');
                    } else {
                        return 'Currently you have no running tasks.';
                    }
                }
            },
            start : {
                getView : function (step)
                {
                    var view = [
                        'Choose the awesome project you are working on today!',
                        ''
                    ];

                    _.each(step.getOptions(), function (option, value) {
                        if (option.type === 'project') {
                            view.push(value + '. ' + option.name);
                        }
                    });

                    view.push('');
                    view.push('Just type the number to choose it or write \'no\' to quit the timer setup');


                    return view.join('\n');
                }
            },
            stop : {
                getView : function (step)
                {
                    var error = step.getParam('stopError'),
                        entry = step.getParam('entry')
                    ;
                    
                    if (typeof error !== 'undefined') {
                        return error;
                    }
                    
                    return [
                        'Successfully stopped the timer for ',
                        entry.client + ' - ' + entry.project + ' - ' + entry.task 
                    ].join('\n');
                }
            }
        },

        validate : function (params, step)
        {
            if (step === null) {
                return true;
            }

            return false;
        },

        execute : function (params, previousStep, callback) {
            var action = tools.validateGet(params, 'action'),
                userId = params.userId,
                name = params.name,
                that = this,
                postStepAction
            ;
            harvest.getTasks(params.userId, function (err, results) {

                if (err !== null) {
                    callback(err, that.createView(null), null);
                } else {
                    var projects = timerParser.findMatchingClientsOrProjects(name, results.projects),
                        step = interactiveSession
                                .getDefault()
                                .createStep(userId, (function (entries) {

                            var options = {};
                            options['no'] = {
                                name : 'Quit',
                                id : null,
                                type : 'system'
                            };

                            _.each(entries, function (entry, index) {

                                options['' + (index + 1) + ''] = {
                                    name : entry.client + ' - ' + entry.project,
                                    id : entry.projectId,
                                    type : 'project'
                                };
                            });

                            return options;
                        })(projects), action);
                        
                        step.addParam('entries', results);
                        
                    postStepAction = that.getPostStepAction(step);
                    if (postStepAction) {
                        postStepAction.execute(step, function () {
                            callback(null, that.createView(step), postStepAction.prepareStep(step));
                        });
                    } else {
                        callback(null, that.createView(step), step);
                    }
                }
            });
        },

        createView : function (step)
        {
            var view = this.getView(step);
            return view;
        },
        
        /**
         * Returns view provider depending on what the step params are
         * 
         * @param       {Object}    step
         * @returns     {String}
         */
        getView : function (step)
        {
            var action,
                errOutput = 'Wrong input provided, try following the instructions...';
            try {
                action = step.getAction();
            } catch (err) {
                return errOutput;
            }
            
            try {
                var provider = tools.validateGet(this.viewsProviders, action);
            } catch (err) {
                return errOutput;
            }
            
            return provider.getView(step);
        },
        
        getPostStepAction : function (step)
        {
            var action = step.getAction(),
                postStepActionProvider = this.postStepActionProviders[action];
                
            return postStepActionProvider ? postStepActionProvider : null;
        }
        
    }));
    
    
    // Step 2 provider
    resolver.addStepProvider(stepFactory({

        stepNumber : 1,

        execute : function (params, previousStep, callback) {
            var value = tools.validateGet(params, 'value'),
                option = previousStep.getOption(value),
                action = previousStep.getAction(),
                projects = previousStep.getParam('entries').projects,
                userId = params.userId,
                that = this,
                tasks, step;

            if (this.prototype.isRejectResponse(option, value)) {
                this.prototype.executeRejectResponse(userId, callback);
                return;
            }
            
            tasks = timerParser.getProjectTasks(option.id, projects);
            
            step = interactiveSession
                    .getDefault()
                    .createStep(userId, (function (tasks) {

                    var options = {};
                    options['no'] = {
                        name : 'Quit',
                        id : null,
                        type : 'system'
                    };

                    _.each(tasks, function (task, index) {

                        options['' + (index + 1) + ''] = {
                            name : task.name,
                            id : task.id,
                            type : 'task'
                        };
                    });

                    return options;
                })(tasks), action);
                
                step.addParam('selectedOption', option);
                callback(null, that.createView(step), step);
        },
        
        
        createView : function (step)
        {
            var view = [
                    'Cool, love that project!',
                    '\n',
                    'What task are you on?',
                    '\n'
                ],
                previousStep = step.getParam('previousStep'),
                dailyEntries = previousStep.getParam('entries').day_entries
            ;
            
            _.each(step.getOptions(), function (option, value) {
                if (option.type === 'task') {
                    view.push(value + '. ' + option.name + (timerParser.isRunningTask(option.id, dailyEntries) ? ' (Currently running)' : ''));
                }
            });

            view.push('');
            view.push('Just type the number to choose it or write \'no\' if you picked the wrong project.');

            return view.join('\n');
        }
    }));
    
    
    
    // Step 3 provider
    resolver.addStepProvider(stepFactory({
        
        stepNumber : 2,

        execute : function (params, previousStep, callback) {
            var value = tools.validateGet(params, 'value'),
                option = previousStep.getOption(value),
                step1 = previousStep.getParam('previousStep'),
                projectId = previousStep.getParam('selectedOption').id,
                userId = params.userId,
                taskId = option.id,
                entries = step1
                            .getParam('entries'),
                dailyEntries = entries.day_entries,
                that = this,
                step = interactiveSession
                    .getDefault()
                    .createStep(userId, {}, previousStep.getAction()),
                dailyEntry,
                resultsCallback;

            if (this.prototype.isRejectResponse(option, value)) {
                this.prototype.executeRejectResponse(params.userId, callback);
                return;
            }
            
            dailyEntry = timerParser.getDailyEntry(taskId, dailyEntries);
            
            var resultsCallback = function (err, result) {
                if (err) {
                    step.addParam('error', err);
                }

                if (!step.getParam('entry')) {
                    step.addParam('entry', result);
                }
                interactiveSession
                        .getDefault()
                        .clear(userId)
                ;
                
                callback(null, that.createView(step), null);
            };
            
            if (dailyEntry === null) {
                harvest.createEntry(params.userId, projectId, taskId, resultsCallback);
            } else {
                harvest.toggle(params.userId, dailyEntry.id, resultsCallback);
            }
        },
        
        
        createView : function (step)
        {
            var entry = step.getParam('entry');
            if (step.getParam('error')) {
                return 'An error occured, please try again later';
            } else {
                return [
                    'Successfully created and started an entry for',
                    entry.client + ' - ' + entry.project + ' - ' + entry.task 
                ].join('\n');
            }
        }
    }));

module.exports = resolver;