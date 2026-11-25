@site
Feature: The work items of the site
  A first feature of a Plane site of the Webship Workspace, placed by the testing setup: the site opens on its login
  form, a member reads the sample project's work items and its cycle, and works a work item of its own, which goes
  after the scenario. It passes on a site built with --install --add-users --sample-content; add your own features
  beside it.

  # A site whose instance is set up asks a visitor to log in; one that is not asks for its setup ("Get started").
  Scenario: The site opens on its login form, set up
    Given I am not logged in
    When I go to the homepage
    Then I should see "Welcome back to Plane"
    And I should not see "Get started"

  Scenario: A member reads the sample project
    Given I am a logged in user with the "member" user
    When I open the project "WEB"
    Then the work item list should show "The greeting script says Helo instead of Hello"
    When I open the cycle "Sprint 1" of the project "WEB"
    Then the cycle should list the work item "The greeting script says Helo instead of Hello"

  Scenario: A member works a work item of its own
    Given there is a work item "Webship test site" in the project "WEB"
    And I am a logged in user with the "member" user
    When I open the work item "Webship test site"
    And I set the state of the work item to "In Progress"
    And I add the comment "Checked on the test site" to the work item
    Then the work item should show the comment "Checked on the test site" by "member"
    And the state of the work item should be "In Progress"

  @js-off
  Scenario: An account with no membership is refused the project
    Given I am a logged in user with the "stranger" user
    Then I should be refused the project "WEB"
