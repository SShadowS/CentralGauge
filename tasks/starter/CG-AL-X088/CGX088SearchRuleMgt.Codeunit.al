codeunit 70532 "CG X088 Search Rule Mgt"
{
    procedure FilterIncompleteRules(var SearchRule: Record "CG X088 Search Rule")
    var
        SearchSetup: Record "CG X088 Search Setup";
    begin
        if not SearchSetup.Get() then
            exit;

        if not SearchSetup."Advanced Filtering Enabled" then
            exit;

        SearchRule.SetRange(Completed, false);
    end;

    procedure HasIncompleteRules(): Boolean
    var
        SearchRule: Record "CG X088 Search Rule";
    begin
        FilterIncompleteRules(SearchRule);
        exit(not SearchRule.IsEmpty());
    end;

    procedure ShowIncompleteRulesNotification()
    var
        RuleNotification: Notification;
    begin
        if HasIncompleteRules() then begin
            RuleNotification.Message := 'Some search rules are incomplete. Open the Search Rules page to complete them before running a search.';
            RuleNotification.Send();
        end;
    end;

    procedure MarkRuleComplete(RuleEntryNo: Integer)
    var
        SearchRule: Record "CG X088 Search Rule";
    begin
        SearchRule.Get(RuleEntryNo);
        SearchRule.Completed := true;
        SearchRule.Modify();
    end;

    procedure CreateRule(RuleName: Text[100]; SearchField: Text[50]): Integer
    var
        SearchRule: Record "CG X088 Search Rule";
    begin
        SearchRule.Init();
        SearchRule."Rule Name" := RuleName;
        SearchRule."Search Field" := SearchField;
        SearchRule.Insert(true);
        exit(SearchRule."Entry No.");
    end;
}
