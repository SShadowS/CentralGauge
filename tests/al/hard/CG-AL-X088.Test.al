codeunit 89085 "CG-AL-X088 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (SOAP
    // runner), so every test either sets the setup record to the state it
    // needs or deletes it outright, and always clears the rule table first.

    local procedure EnableAdvancedFiltering(Enabled: Boolean)
    var
        SearchSetup: Record "CG X088 Search Setup";
    begin
        if not SearchSetup.Get() then begin
            SearchSetup.Init();
            SearchSetup.Insert();
        end;
        SearchSetup."Advanced Filtering Enabled" := Enabled;
        SearchSetup.Modify();
    end;

    [Test]
    procedure FlagOffWithIncompleteRulesPresentDoesNotWarn()
    var
        SearchRule: Record "CG X088 Search Rule";
        SearchRuleMgt: Codeunit "CG X088 Search Rule Mgt";
        DoneId: Integer;
    begin
        SearchRule.DeleteAll();
        EnableAdvancedFiltering(false);

        DoneId := SearchRuleMgt.CreateRule('Vendor Lookup', 'Vendor No.');
        SearchRuleMgt.MarkRuleComplete(DoneId);
        SearchRuleMgt.CreateRule('Item Lookup', 'Item No.');

        Assert.IsFalse(SearchRuleMgt.HasIncompleteRules(), 'No warning is expected while advanced filtering is turned off');
    end;

    [Test]
    procedure FlagOnWithAnIncompleteRuleWarns()
    var
        SearchRule: Record "CG X088 Search Rule";
        SearchRuleMgt: Codeunit "CG X088 Search Rule Mgt";
    begin
        SearchRule.DeleteAll();
        EnableAdvancedFiltering(true);

        SearchRuleMgt.CreateRule('Customer Lookup', 'Customer No.');

        Assert.IsTrue(SearchRuleMgt.HasIncompleteRules(), 'A warning is expected while an incomplete rule exists');
    end;

    [Test]
    procedure FlagOnWithEveryRuleCompleteDoesNotWarn()
    var
        SearchRule: Record "CG X088 Search Rule";
        SearchRuleMgt: Codeunit "CG X088 Search Rule Mgt";
        RuleId: Integer;
    begin
        SearchRule.DeleteAll();
        EnableAdvancedFiltering(true);

        Assert.IsFalse(SearchRuleMgt.HasIncompleteRules(), 'No warning is expected while the rule list is empty');

        RuleId := SearchRuleMgt.CreateRule('Contact Lookup', 'Contact No.');
        SearchRuleMgt.MarkRuleComplete(RuleId);

        Assert.IsFalse(SearchRuleMgt.HasIncompleteRules(), 'No warning is expected once every rule is complete');
    end;

    [Test]
    procedure FlagOffWithNoRulesAtAllDoesNotWarn()
    var
        SearchRule: Record "CG X088 Search Rule";
        SearchRuleMgt: Codeunit "CG X088 Search Rule Mgt";
    begin
        SearchRule.DeleteAll();
        EnableAdvancedFiltering(false);

        SearchRuleMgt.ShowIncompleteRulesNotification();

        Assert.IsFalse(SearchRuleMgt.HasIncompleteRules(), 'No warning is expected while the rule list is empty');
    end;

    [Test]
    procedure NoSetupRecordWithIncompleteRulesPresentDoesNotWarn()
    var
        SearchRule: Record "CG X088 Search Rule";
        SearchSetup: Record "CG X088 Search Setup";
        SearchRuleMgt: Codeunit "CG X088 Search Rule Mgt";
    begin
        SearchRule.DeleteAll();
        SearchSetup.DeleteAll();

        SearchRuleMgt.CreateRule('Location Lookup', 'Location Code');

        Assert.IsFalse(SearchRuleMgt.HasIncompleteRules(), 'No warning is expected before the search setup has ever been configured');
    end;

    [Test]
    procedure CompletingEveryPendingRuleStopsTheWarning()
    var
        SearchRule: Record "CG X088 Search Rule";
        SearchRuleMgt: Codeunit "CG X088 Search Rule Mgt";
        OldestId: Integer;
        MiddleId: Integer;
        NewestId: Integer;
    begin
        SearchRule.DeleteAll();
        EnableAdvancedFiltering(true);

        OldestId := SearchRuleMgt.CreateRule('Order Lookup', 'Order No.');
        MiddleId := SearchRuleMgt.CreateRule('Shipment Lookup', 'Shipment No.');
        NewestId := SearchRuleMgt.CreateRule('Invoice Lookup', 'Invoice No.');

        Assert.IsTrue(SearchRuleMgt.HasIncompleteRules(), 'A warning is expected while rules are still pending');

        // Complete the newest rule first, then the oldest - the one rule
        // still left afterward (the middle one) is neither the first nor
        // the last by insertion order.
        SearchRuleMgt.MarkRuleComplete(NewestId);
        Assert.IsTrue(SearchRuleMgt.HasIncompleteRules(), 'A warning is still expected while two rules remain pending');

        SearchRuleMgt.MarkRuleComplete(OldestId);
        Assert.IsTrue(SearchRuleMgt.HasIncompleteRules(), 'A warning is still expected while one rule remains pending');

        SearchRuleMgt.MarkRuleComplete(MiddleId);
        Assert.IsFalse(SearchRuleMgt.HasIncompleteRules(), 'No warning is expected once the last pending rule is completed');
    end;
}
