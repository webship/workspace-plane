@roles
Feature: What each account may do in the project
  Scenario: A Guest sees only the work items it created, and moves none
    Given I am a logged in user with the "reader" user
    When I open the project "WEB"
    Then the work item list should show "An issue opened by someone outside the project"
    And the work item list should not show "The greeting script says Helo instead of Hello"
    When I open the work item "WEB-3"
    Then I should not be able to change the state of the work item

  @js-off
  Scenario: An account with no membership is refused the project
    Given I am a logged in user with the "stranger" user
    Then I should be refused the project "WEB"
