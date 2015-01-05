module.exports = function(grunt) {
	"use strict"; // plusz dolgokat ellenőriz a böngésző
	// Project configuration.
	grunt.initConfig({
		pkg : grunt.file.readJSON('package.json'),
		karma : {
			options : {
				configFile : 'karma.conf.js',
			},
			ci : {
				singleRun : true
			},
			dev : {
				singleRun : false
			}
		}

	});
	grunt.loadNpmTasks('grunt-karma');
	// Default task(s).
	grunt.registerTask('default', [ 'karma:dev' ]);

};