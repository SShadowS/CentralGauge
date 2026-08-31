codeunit 89479 "CG-AL-X257 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    EventSubscriberInstance = Manual;

    // This oracle merges 6 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods (SOAP
        // runner), so every test clears both tables before seeding its own rows.
        // Sentinel field values are always distinct from anything a sync call
        // would write, so "untouched" and "overwritten by the feed" stay
        // distinguishable.
        // The default test isolation persists writes between test methods
        // (measured, SOAP runner), so every test that seeds rows clears the
        // table first. A second, unrelated batch is seeded with nonzero
        // sentinel values wherever isolation is under test, so "untouched" and
        // "wiped" stay distinguishable.
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.

    // ==========================================================
    // X067 - donor CG-AL-X067
    // ==========================================================

    local procedure X067_Activate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Promotion);
    end;

    local procedure X067_Deactivate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Promotion);
    end;

    local procedure X067_ActivateFreightOverride(var Override: Codeunit "CG-AL-X257 Test")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Override);
    end;

    local procedure X067_DeactivateFreightOverride(var Override: Codeunit "CG-AL-X257 Test")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Override);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X067 Freight Calculator", 'OnBeforeCalculateFreight', '', false, false)]
    local procedure X067_ApplyAFlatFreightOverride(Amount: Decimal; var Freight: Decimal; var IsHandled: Boolean)
    begin
        Freight := 42.5;
        IsHandled := true;
    end;

    [Test]
    procedure X067_DefaultFreightAppliesForOrdersUnderTheThreshold()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Nothing has activated the promotion, and the order is small
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 with the promotion not activated', Amount));
    end;

    [Test]
    procedure X067_DefaultFreightAppliesJustBelowTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] One cent below the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(999.99),
            'Expected the standard charge for 999.99 with the promotion not activated - the threshold is 1000, one cent below it must not qualify');
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightWhenThePromotionHasNotBeenActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] A large order, but nothing has activated the promotion for this call
        Amount := Any.DecimalInRange(1001, 5000, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for a large order of %1 while the promotion has NOT been activated for this call', Amount));
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightAtExactlyTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] Exactly at the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(1000),
            'Expected the standard charge for an order of exactly 1000 while the promotion has NOT been activated for this call');
    end;

    [Test]
    procedure X067_ActivatedPromotionGrantsFreeFreightFromTheThresholdUpward()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] The caller has explicitly activated the promotion for this call
        X067_Activate(Promotion);

        Assert.AreEqual(0, Calculator.CalculateFreight(1000),
            'Expected free freight for an order of exactly 1000 while the promotion is activated for this call');

        Amount := Any.DecimalInRange(1001, 5000, 2);
        Assert.AreEqual(0, Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected free freight for an order of %1 while the promotion is activated for this call', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_ActivatedPromotionLeavesOrdersBelowTheThresholdAtTheDefaultCharge()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Activated, but the order does not reach the threshold
        X067_Activate(Promotion);
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 - below the threshold, the activated promotion must still leave it alone', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_CalculatedFreightReflectsTheAmountAnActiveOverrideSets()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Override: Codeunit "CG-AL-X257 Test";
    begin
        // [SCENARIO] A subscriber other than the promotion has taken over this call and set its own charge
        X067_ActivateFreightOverride(Override);

        Assert.AreEqual(42.5, Calculator.CalculateFreight(1),
            'Expected the returned charge to reflect the amount an active override sets, not a fixed zero');

        X067_DeactivateFreightOverride(Override);
    end;

    // ==========================================================
    // X086 - donor CG-AL-X086
    // ==========================================================

    local procedure X086_SeedContact(ContactId: Code[20]; CompanyName: Text[100]; VATRegistrationNo: Text[20]; Address: Text[100]; Status: Text[20]; LastSynced: DateTime)
    var
        Contact: Record "CG X086 Contact";
    begin
        Contact.Init();
        Contact."Contact Id" := ContactId;
        Contact."Company Name" := CompanyName;
        Contact."VAT Registration No." := VATRegistrationNo;
        Contact."Address" := Address;
        Contact."Status" := Status;
        Contact."Last Synced" := LastSynced;
        Contact.Insert();
    end;

    local procedure X086_SeedFeedLine(LineNo: Integer; ExternalContactId: Code[20]; NewExternalContactId: Code[20]; CompanyName: Text[100]; VATRegistrationNo: Text[20]; Address: Text[100]; Status: Text[20])
    var
        FeedLine: Record "CG X086 Feed Line";
    begin
        FeedLine.Init();
        FeedLine."Line No." := LineNo;
        FeedLine."External Contact Id" := ExternalContactId;
        FeedLine."New External Contact Id" := NewExternalContactId;
        FeedLine."Company Name" := CompanyName;
        FeedLine."VAT Registration No." := VATRegistrationNo;
        FeedLine."Address" := Address;
        FeedLine."Status" := Status;
        FeedLine.Insert();
    end;

    [Test]
    procedure X086_NewContactIsInsertedFromFeedWithNoRenameRequested()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        X086_SeedContact('UNTOUCH1', 'Untouched Co', 'UNTOUCHVAT', 'Untouched Addr', 'UntouchedStat', CreateDateTime(20250101D, 080000T));
        X086_SeedFeedLine(1, 'NEWCUST1', '', 'Brand New Co', 'NEWVAT01', 'New Addr', 'Active');

        FeedImport.ImportFeed(FeedLine);

        Contact.Get('NEWCUST1');
        Assert.AreEqual('Brand New Co', Contact."Company Name", 'A first-time feed contact must be created with the feed''s company name');
        Assert.AreEqual('NEWVAT01', Contact."VAT Registration No.", 'A first-time feed contact must be created with the feed''s VAT registration number');
        Assert.AreEqual('New Addr', Contact."Address", 'A first-time feed contact must be created with the feed''s address');
        Assert.AreEqual('Active', Contact."Status", 'A first-time feed contact must be created with the feed''s status');

        Contact.Get('UNTOUCH1');
        Assert.AreEqual('Untouched Co', Contact."Company Name", 'An unrelated contact must not be affected by importing a different feed line');
    end;

    [Test]
    procedure X086_CleanRenameMovesContactAndRefreshesFieldsUnderTheNewId()
    var
        Contact: Record "CG X086 Contact";
        ContactSync: Codeunit "CG X086 Contact Sync";
    begin
        Contact.DeleteAll();
        X086_SeedContact('OLDID1', 'Old Name', 'OLDVAT01', 'Old Addr', 'OldStat', CreateDateTime(20250101D, 080000T));

        ContactSync.SyncContact('OLDID1', 'NEWID1', 'Renamed Co', 'NEWVAT01', 'New Addr', 'Active');

        Assert.IsTrue(Contact.Get('NEWID1'), 'The contact must be found under the feed''s new id after a non-colliding rename');
        Assert.AreEqual('Renamed Co', Contact."Company Name", 'The renamed contact''s company name must come from the feed');
        Assert.AreEqual('NEWVAT01', Contact."VAT Registration No.", 'The renamed contact''s VAT registration number must come from the feed');
        Assert.AreEqual('New Addr', Contact."Address", 'The renamed contact''s address must come from the feed');
        Assert.AreEqual('Active', Contact."Status", 'The renamed contact''s status must come from the feed');
        Assert.IsFalse(Contact.Get('OLDID1'), 'The contact must no longer be found under its old id once the rename has been applied');
    end;

    [Test]
    procedure X086_CleanMergeViaImportFeedMovesContactAndRefreshesFieldsUnderTheNewId()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        X086_SeedContact('OLDID2', 'Old Name Two', 'OLDVAT02', 'Old Addr Two', 'OldStat2', CreateDateTime(20250101D, 080000T));
        X086_SeedFeedLine(1, 'OLDID2', 'NEWID2', 'Merged Co', 'MERGEVAT2', 'Merged Addr', 'Active');

        FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('NEWID2'), 'The contact must be found under the feed''s merged id after ImportFeed applies a non-colliding merge');
        Assert.AreEqual('Merged Co', Contact."Company Name", 'The merged contact''s company name must come from the feed');
        Assert.AreEqual('MERGEVAT2', Contact."VAT Registration No.", 'The merged contact''s VAT registration number must come from the feed');
        Assert.AreEqual('Merged Addr', Contact."Address", 'The merged contact''s address must come from the feed');
        Assert.AreEqual('Active', Contact."Status", 'The merged contact''s status must come from the feed');
        Assert.IsFalse(Contact.Get('OLDID2'), 'The contact must no longer be found under its old id once ImportFeed has applied the merge');
    end;

    [Test]
    procedure X086_CollisionSkipLeavesTheLosingContactUnderItsOldIdWithStaleFields()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        X086_SeedContact('TARGET1', 'Target Co', 'TARGVAT01', 'Target Addr', 'TargetStat', CreateDateTime(20250101D, 080000T));
        X086_SeedContact('LOSING1', 'Losing Co', 'LOSEVAT01', 'Losing Addr', 'LosingStat', CreateDateTime(20250102D, 080000T));
        X086_SeedFeedLine(1, 'LOSING1', 'TARGET1', 'Feed Update Co', 'FEEDVAT1', 'Feed Addr', 'FeedStat');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('LOSING1'), 'The losing contact must still be found under its old id after a colliding sync is attempted');
        Assert.AreEqual('Losing Co', Contact."Company Name", 'A colliding sync must not refresh the losing contact''s company name');
        Assert.AreEqual('LOSEVAT01', Contact."VAT Registration No.", 'A colliding sync must not refresh the losing contact''s VAT registration number');
        Assert.AreEqual('Losing Addr', Contact."Address", 'A colliding sync must not refresh the losing contact''s address');
        Assert.AreEqual('LosingStat', Contact."Status", 'A colliding sync must not refresh the losing contact''s status');
        Assert.AreEqual(CreateDateTime(20250102D, 080000T), Contact."Last Synced", 'A colliding sync must not refresh the losing contact''s last-synced time');
    end;

    [Test]
    procedure X086_CollisionSkipLeavesTheCollidingContactUntouched()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        X086_SeedContact('TARGET2', 'Target Co Two', 'TARGVAT02', 'Target Addr Two', 'TargetStatTwo', CreateDateTime(20250101D, 080000T));
        X086_SeedContact('LOSING2', 'Losing Co Two', 'LOSEVAT02', 'Losing Addr Two', 'LosingStatTwo', CreateDateTime(20250102D, 080000T));
        X086_SeedFeedLine(1, 'LOSING2', 'TARGET2', 'Feed Update Co Two', 'FEEDVAT2', 'Feed Addr Two', 'FeedStatTwo');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('TARGET2'), 'The already-correct target contact must still exist after a colliding sync is attempted');
        Assert.AreEqual('Target Co Two', Contact."Company Name", 'A colliding sync must not overwrite the target contact''s company name with the losing contact''s feed data');
        Assert.AreEqual('TARGVAT02', Contact."VAT Registration No.", 'A colliding sync must not overwrite the target contact''s VAT registration number with the losing contact''s feed data');
        Assert.AreEqual('Target Addr Two', Contact."Address", 'A colliding sync must not overwrite the target contact''s address with the losing contact''s feed data');
        Assert.AreEqual('TargetStatTwo', Contact."Status", 'A colliding sync must not overwrite the target contact''s status with the losing contact''s feed data');
        Assert.AreEqual(CreateDateTime(20250101D, 080000T), Contact."Last Synced", 'A colliding sync must not overwrite the target contact''s last-synced time with the losing contact''s feed data');
    end;

    [Test]
    procedure X086_CollisionSkipStaysInEffectOnEveryRepeatedSync()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        X086_SeedContact('TARGET3', 'Target Co Three', 'TARGVAT03', 'Target Addr Three', 'TargetStat3', CreateDateTime(20250101D, 080000T));
        X086_SeedContact('LOSING3', 'Losing Co Three', 'LOSEVAT03', 'Losing Addr Three', 'LosingStat3', CreateDateTime(20250102D, 080000T));
        X086_SeedFeedLine(1, 'LOSING3', 'TARGET3', 'First Feed Update', 'FEEDVAT3A', 'Feed Addr 3A', 'FeedStat3A');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);
        Commit();

        FeedLine.Get(1);
        FeedLine."Company Name" := 'Second Feed Update';
        FeedLine."VAT Registration No." := 'FEEDVAT3B';
        FeedLine."Address" := 'Feed Addr 3B';
        FeedLine."Status" := 'FeedStat3B';
        FeedLine.Modify();
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('LOSING3'), 'The losing contact must still be found under its old id after repeated colliding syncs');
        Assert.AreEqual('Losing Co Three', Contact."Company Name", 'Repeated colliding syncs must not eventually refresh the losing contact''s company name');
        Assert.AreEqual('LOSEVAT03', Contact."VAT Registration No.", 'Repeated colliding syncs must not eventually refresh the losing contact''s VAT registration number');
    end;

    // ==========================================================
    // X092 - donor CG-AL-X092
    // ==========================================================

    local procedure X092_AssertDecimalRoundTrips(Original: Decimal)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Decimal;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDecimal(Original);

        Assert.IsTrue(WireFormat.FromWireDecimal(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original amount %2', WireText, Original));
    end;

    local procedure X092_AssertDateRoundTrips(Original: Date)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Date;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDate(Original);

        Assert.IsTrue(WireFormat.FromWireDate(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original date %2', WireText, Original));
    end;

    [Test]
    procedure X092_ToWireDecimalRendersPlainDigitsWithDotSeparator()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1234567.89', WireFormat.ToWireDecimal(1234567.89),
            'Expected the amount as plain digits with a dot before the fraction, with no separator a receiving server would read differently depending on its own regional settings');
    end;

    [Test]
    procedure X092_ToWireDecimalKeepsLeadingMinusForNegativeValues()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('-1234.5', WireFormat.ToWireDecimal(-1234.5),
            'Expected a leading minus with plain digits and a dot before the fraction, the same on every server');
    end;

    [Test]
    procedure X092_ToWireDecimalStaysPlainBelowTheFirstGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('999', WireFormat.ToWireDecimal(999),
            'Expected a whole amount under a thousand to render as plain digits');
    end;

    [Test]
    procedure X092_ToWireDecimalHasNoGroupSeparatorAtTheGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1000', WireFormat.ToWireDecimal(1000),
            'Expected a whole amount at a thousand to still render as plain digits, with no separator marking the thousands');
    end;

    [Test]
    procedure X092_ToWireDateRendersYearMonthDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-01-23', WireFormat.ToWireDate(DMY2Date(23, 1, 2026)),
            'Expected 23 January 2026 to render as 2026-01-23 on every server');
    end;

    [Test]
    procedure X092_ToWireDatePadsSingleDigitMonthAndDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-02-03', WireFormat.ToWireDate(DMY2Date(3, 2, 2026)),
            'Expected zero-padded month and day: 3 February 2026 is 2026-02-03 on every server');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('1234.56', Value),
            'Expected the wire text 1234.56 to be accepted');
        Assert.AreEqual(1234.56, Value, 'Expected the wire text 1234.56 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesNegativeWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('-42.75', Value),
            'Expected the wire text -42.75 to be accepted');
        Assert.AreEqual(-42.75, Value, 'Expected the wire text -42.75 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsCommaFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDecimal('1,5', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 1,5 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsFalse(WireFormat.FromWireDecimal('twelve point five', Value),
            'Expected text that is no amount at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_FromWireDateParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsTrue(WireFormat.FromWireDate('2026-01-23', Value),
            'Expected the wire text 2026-01-23 to be accepted');
        Assert.AreEqual(DMY2Date(23, 1, 2026), Value, 'Expected the wire text 2026-01-23 to parse to 23 January 2026');
    end;

    [Test]
    procedure X092_FromWireDateRejectsLocaleFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDate('05-02-2026', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 05-02-2026 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDateRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsFalse(WireFormat.FromWireDate('23rd of January 2026', Value),
            'Expected text that is no wire date at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_DecimalRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDecimalRoundTrips(1000);
        X092_AssertDecimalRoundTrips(12345.67);
        X092_AssertDecimalRoundTrips(-98765.43);
        X092_AssertDecimalRoundTrips(2000000);
        X092_AssertDecimalRoundTrips(-1500.25);
        X092_AssertDecimalRoundTrips(42.5);
    end;

    [Test]
    procedure X092_DateRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDateRoundTrips(DMY2Date(1, 1, 2026));
        X092_AssertDateRoundTrips(DMY2Date(31, 12, 2026));
        X092_AssertDateRoundTrips(DMY2Date(29, 2, 2028));
        X092_AssertDateRoundTrips(DMY2Date(15, 6, 2025));
    end;

    // ==========================================================
    // X130 - donor CG-AL-X130
    // ==========================================================

    local procedure X130_Joined(Ids: List of [Code[20]]): Text
    var
        Id: Code[20];
        Result: Text;
    begin
        foreach Id in Ids do begin
            if Result <> '' then
                Result += '|';
            Result += Id;
        end;
        exit(Result);
    end;

    [Test]
    procedure X130_NoSignupsMeansNothingIsWaitingYet()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
    begin
        Tracker.Attach(Queue.PendingSignups());

        Assert.AreEqual('', X130_Joined(Queue.PendingSignups()), 'The queue should not report any waiting customers yet');
        Assert.AreEqual('', X130_Joined(Tracker.AwaitingOutreach()), 'The tracker should not report any waiting customers yet');
    end;

    [Test]
    procedure X130_TrackerSeesSignupsAddedBeforeAndAfterAttaching()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
    begin
        Queue.QueueSignup('CUST001');
        Queue.QueueSignup('CUST002');

        Tracker.Attach(Queue.PendingSignups());

        Queue.QueueSignup('CUST003');
        Queue.QueueSignup('CUST004');

        Assert.AreEqual('CUST001|CUST002|CUST003|CUST004', X130_Joined(Queue.PendingSignups()), 'The queue must report every customer who signed up, in order');
        Assert.AreEqual('CUST001|CUST002|CUST003|CUST004', X130_Joined(Tracker.AwaitingOutreach()), 'The tracker must report every customer who signed up, including those who signed up after it started watching');
    end;

    [Test]
    procedure X130_TrackerAgreesWithQueueAfterStartingANewDay()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
    begin
        Queue.QueueSignup('CUST010');
        Queue.QueueSignup('CUST011');
        Tracker.Attach(Queue.PendingSignups());

        Queue.StartNewDay();
        Queue.QueueSignup('CUST020');

        Assert.AreEqual('CUST020', X130_Joined(Queue.PendingSignups()), 'The queue itself must only report the new day''s signup');
        Assert.AreEqual('CUST020', X130_Joined(Tracker.AwaitingOutreach()), 'The tracker must report exactly the same waiting customers the queue reports');
    end;

    [Test]
    procedure X130_TrackerAgreesWithQueueAcrossSeveralNewDays()
    var
        Queue: Codeunit "CG X130 Signup Queue";
        Tracker: Codeunit "CG X130 Outreach Tracker";
        Day: Integer;
        ExpectedIds: Text;
    begin
        Tracker.Attach(Queue.PendingSignups());

        for Day := 1 to 4 do begin
            Queue.StartNewDay();

            Assert.AreEqual('', X130_Joined(Queue.PendingSignups()), 'The queue must report nothing waiting right after starting a new day');
            Assert.AreEqual('', X130_Joined(Tracker.AwaitingOutreach()), 'The tracker must report nothing waiting right after starting a new day');

            Queue.QueueSignup('D' + Format(Day) + 'CUSTA');
            Queue.QueueSignup('D' + Format(Day) + 'CUSTB');

            ExpectedIds := 'D' + Format(Day) + 'CUSTA|D' + Format(Day) + 'CUSTB';

            Assert.AreEqual(ExpectedIds, X130_Joined(Queue.PendingSignups()), 'The queue must only report the current day''s signups');
            Assert.AreEqual(ExpectedIds, X130_Joined(Tracker.AwaitingOutreach()), 'The tracker must report exactly the same waiting customers the queue reports, every day');
        end;
    end;

    [Test]
    procedure X130_TwoIndependentQueuesTrackTheirOwnCustomers()
    var
        QueueA: Codeunit "CG X130 Signup Queue";
        TrackerA: Codeunit "CG X130 Outreach Tracker";
        QueueB: Codeunit "CG X130 Signup Queue";
        TrackerB: Codeunit "CG X130 Outreach Tracker";
    begin
        QueueA.QueueSignup('CUSTA1');
        TrackerA.Attach(QueueA.PendingSignups());

        QueueB.QueueSignup('CUSTB1');
        TrackerB.Attach(QueueB.PendingSignups());

        QueueA.StartNewDay();
        QueueA.QueueSignup('CUSTA2');

        Assert.AreEqual('CUSTB1', X130_Joined(QueueB.PendingSignups()), 'A second, unrelated queue must not be affected by another queue starting a new day');
        Assert.AreEqual('CUSTB1', X130_Joined(TrackerB.AwaitingOutreach()), 'A second, unrelated tracker must not be affected by another queue starting a new day');

        Assert.AreEqual('CUSTA2', X130_Joined(QueueA.PendingSignups()), 'The queue must only report the new day''s signup');
        Assert.AreEqual('CUSTA2', X130_Joined(TrackerA.AwaitingOutreach()), 'The tracker must report exactly the same waiting customer the queue reports');
    end;

    // ==========================================================
    // X131 - donor CG-AL-X131
    // ==========================================================

    local procedure X131_MakeLine(var ImportLine: Record "CG X131 Import Line"; BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    begin
        ImportLine.Init();
        ImportLine."Batch Code" := BatchCode;
        ImportLine."Line No." := LineNo;
        ImportLine."Item No." := ItemNo;
        ImportLine.Quantity := NewQuantity;
        ImportLine."Unit Cost" := NewUnitCost;
    end;

    local procedure X131_InsertLine(BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    var
        ImportLine: Record "CG X131 Import Line";
    begin
        X131_MakeLine(ImportLine, BatchCode, LineNo, ItemNo, NewQuantity, NewUnitCost);
        ImportLine.Insert();
    end;

    [Test]
    procedure X131_CheckLineAcceptsAFullyValidLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A line satisfying every rule should report no problems');
    end;

    [Test]
    procedure X131_CheckLineAcceptsAZeroUnitCost()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 0);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Unit Cost of exactly 0 is allowed - only a negative cost is a problem');
    end;

    [Test]
    procedure X131_CheckLineAcceptsAQuantityJustAboveZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 0.01, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Quantity just above zero is allowed - only zero or below is a problem');
    end;

    [Test]
    procedure X131_CheckLineReportsAMissingItemNo()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, '', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A blank Item No. is the only problem on this line');
        Assert.AreEqual('Line 10000: Item No. is missing.', LineMessages.Get(1), 'Expected the missing-item message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsAZeroQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', 0, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A zero Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsANegativeQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', -3, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A negative Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsAUnitCostJustBelowZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 30000, 'ITEM-1', 5, -0.01);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A Unit Cost just below zero is the only problem on this line');
        Assert.AreEqual('Line 30000: Unit Cost cannot be negative.', LineMessages.Get(1), 'Expected the unit cost message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsOnlyTheFirstRuleWhenAllThreeAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 40000, '', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line breaking every rule must still report exactly one problem - its first broken rule');
        Assert.AreEqual('Line 40000: Item No. is missing.', LineMessages.Get(1), 'Expected the FIRST rule in the order (Item No., then Quantity, then Unit Cost) to be the one reported');
    end;

    [Test]
    procedure X131_CheckLineReportsTheQuantityRuleWhenItemIsValidButQuantityAndCostAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 50000, 'ITEM-1', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line with a valid Item No. but two broken rules must still report exactly one problem');
        Assert.AreEqual('Line 50000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected Quantity - the earlier rule of the two remaining - to be the one reported, not Unit Cost');
    end;

    [Test]
    procedure X131_CheckBatchReportsOneMessagePerProblemLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-A', 10000, 'ITEM-1', 5, 10);
        X131_InsertLine('BATCH-A', 20000, 'ITEM-2', 0, 10);
        X131_InsertLine('BATCH-A', 30000, '', 0, -5);
        X131_InsertLine('BATCH-A', 40000, 'ITEM-4', 3, 8);

        Checker.CheckBatch('BATCH-A', Problems);

        Assert.AreEqual(2, Problems.Count(), 'Expected exactly one problem per problem line - two lines are broken, not more entries for the line breaking several rules');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(1), 'Expected the first problem to belong to line 20000, in line order');
        Assert.AreEqual('Line 30000: Item No. is missing.', Problems.Get(2), 'Expected the second problem to be line 30000''s FIRST broken rule, not one entry per rule it breaks');
    end;

    [Test]
    procedure X131_CheckBatchIgnoresLinesOfOtherBatches()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-B1', 10000, '', 5, 10);
        X131_InsertLine('BATCH-B2', 20000, '', 7, 20);

        Checker.CheckBatch('BATCH-B1', Problems);

        Assert.AreEqual(1, Problems.Count(), 'The other batch''s broken line must not leak into this batch''s result');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the reported problem to belong to the requested batch');

        ImportLine.Get('BATCH-B2', 20000);
        Assert.AreEqual('', ImportLine."Item No.", 'The other batch''s line must be left exactly as seeded');
        Assert.AreEqual(7, ImportLine.Quantity, 'The other batch''s Quantity must survive untouched');
        Assert.AreEqual(20, ImportLine."Unit Cost", 'The other batch''s Unit Cost must survive untouched');
    end;

    [Test]
    procedure X131_CheckBatchReturnsAnEmptyListForACleanBatch()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-C', 10000, 'ITEM-1', 5, 10);
        X131_InsertLine('BATCH-C', 20000, 'ITEM-2', 3, 0);

        Checker.CheckBatch('BATCH-C', Problems);

        Assert.AreEqual(0, Problems.Count(), 'A batch where every line passes every rule must report no problems');
    end;

    [Test]
    procedure X131_CheckBatchReplacesEarlierListContents()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-D', 10000, '', 5, 10);
        X131_InsertLine('BATCH-D', 20000, 'ITEM-2', 0, 10);

        Checker.CheckBatch('BATCH-D', Problems);
        Checker.CheckBatch('BATCH-D', Problems);

        Assert.AreEqual(2, Problems.Count(), 'A second run must replace the first run''s findings, not add to them');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the first problem of the second run to still be line 10000');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(2), 'Expected the second problem of the second run to still be line 20000');
    end;

    // ==========================================================
    // X140 - donor CG-AL-X140
    // ==========================================================

    local procedure X140_ClearAllData()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.DeleteAll();
        RebateHeader.DeleteAll();
    end;

    local procedure X140_SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        RebateHeader: Record "CG X140 Rebate Header";
    begin
        RebateHeader.Init();
        RebateHeader."No." := DocumentNo;
        RebateHeader."Rebate Description" := 'Test rebate';
        RebateHeader."Total Rebate Amount" := TotalAmount;
        RebateHeader.Insert();
    end;

    local procedure X140_SeedLine(DocumentNo: Code[20]; LineNo: Integer; ItemDescription: Text[100]; LineWeight: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Item Description" := ItemDescription;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine.Insert();
    end;

    local procedure X140_SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine."Rebate Amount" := SentinelAmount;
        RebateLine.Insert();
    end;

    local procedure X140_GetLineAmount(DocumentNo: Code[20]; LineNo: Integer): Decimal
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Get(DocumentNo, LineNo);
        exit(RebateLine."Rebate Amount");
    end;

    // Independently reconstructs the allocation every correct implementation
    // must produce: floor everyone's exact proportional share to the cent,
    // then hand out whatever the floors left on the table one cent at a time
    // to the lines closest to rounding up, tie-broken by the lower line
    // number. A zero-weight line's remainder is always exactly zero, so it
    // never competes for a leftover cent. This mirrors the allocator's own
    // fix - it is the definition of "correct" this oracle grades against,
    // not a re-implementation that happens to agree with one particular
    // solution.
    local procedure X140_ComputeExpectedShares(Weight: array[10] of Decimal; LineNo: array[10] of Integer; LineCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
    var
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to LineCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to LineCount do begin
            Awarded[i] := false;
            if (WeightSum = 0) or (Weight[i] = 0) then begin
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalAmount * Weight[i] / WeightSum;
                ExpectedShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedShare[i];
                FloorSum += ExpectedShare[i];
            end;
        end;

        if WeightSum = 0 then
            exit;

        RemainingResidual := TotalAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to LineCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" indexes Remainder[0] on the first
                    // candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (LineNo[i] < LineNo[WinnerIndex]))
                        then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure X140_SingleNonzeroWeightLineGetsTheEntireTotal()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('SL01', 123.45);
        X140_SeedLine('SL01', 1, 'Widget', 7.5);

        Allocator.AllocateRebate('SL01');

        Assert.AreEqual(123.45, X140_GetLineAmount('SL01', 1), 'Expected a document with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure X140_TwoEvenlyWeightedLinesSplitCleanlyAndLeaveAnotherDocumentUntouched()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('EV01', 10.00);
        X140_SeedLine('EV01', 1, 'Widget A', 1);
        X140_SeedLine('EV01', 2, 'Widget B', 1);

        // A second, unrelated document is seeded with its own nonzero
        // sentinel amounts and left alone - allocating EV01 must not
        // touch it.
        X140_SeedHeader('EV02', 250.00);
        X140_SeedLineWithSentinel('EV02', 1, 1, 111.11);
        X140_SeedLineWithSentinel('EV02', 2, 1, 222.22);

        Allocator.AllocateRebate('EV01');

        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 1), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 2), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(10.00, Allocator.GetAllocatedTotal('EV01'), 'Expected the reconciliation total to equal the header total after allocating');

        RebateHeader.Get('EV02');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected an untouched document to stay unallocated');
        Assert.AreEqual(111.11, X140_GetLineAmount('EV02', 1), 'Expected another document''s line amount to be left untouched by allocating a different document');
        Assert.AreEqual(222.22, X140_GetLineAmount('EV02', 2), 'Expected another document''s line amount to be left untouched by allocating a different document');
        // EV02's own lines (333.33) do not reconcile with its own header
        // total (250.00) by design - it was never allocated. Pinning the
        // reconciliation total against the lines' own sum here, not the
        // header total, catches a GetAllocatedTotal that just echoes the
        // header field instead of actually reading the lines.
        Assert.AreEqual(333.33, Allocator.GetAllocatedTotal('EV02'), 'Expected the reconciliation total to reflect the document''s own recorded line amounts');
    end;

    [Test]
    procedure X140_AZeroWeightLineAlwaysReceivesExactlyZero()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        // Weights chosen so every nonzero-weight line's exact share has a
        // distinct rounding remainder (no ties), so this fixture pins an
        // outcome that does not depend on any particular tie-break policy.
        X140_ClearAllData();
        X140_SeedHeader('ZL01', 77.77);
        X140_SeedLine('ZL01', 1, 'Item P', 2.3);
        X140_SeedLine('ZL01', 2, 'Item Q', 5.7);
        X140_SeedLine('ZL01', 3, 'Item R', 3.1);
        X140_SeedLine('ZL01', 4, 'Item S', 1.9);
        X140_SeedLine('ZL01', 5, 'Sample T (FOC)', 0);

        Allocator.AllocateRebate('ZL01');

        Assert.AreEqual(13.76, X140_GetLineAmount('ZL01', 1), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(34.10, X140_GetLineAmount('ZL01', 2), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(18.54, X140_GetLineAmount('ZL01', 3), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(11.37, X140_GetLineAmount('ZL01', 4), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(0.00, X140_GetLineAmount('ZL01', 5), 'Expected a line with no allocation weight to receive exactly zero');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('ZL01'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ReorderingTheSameLinesNeverChangesTheirRebateAmount()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();

        // Document PM01: lines entered P, Q, R, S.
        X140_SeedHeader('PM01', 77.77);
        X140_SeedLine('PM01', 1, 'Item P', 2.3);
        X140_SeedLine('PM01', 2, 'Item Q', 5.7);
        X140_SeedLine('PM01', 3, 'Item R', 3.1);
        X140_SeedLine('PM01', 4, 'Item S', 1.9);

        // Document PM02: the exact same four items, same weights, same
        // total - only Item R and Item S swap which line number they
        // were entered on.
        X140_SeedHeader('PM02', 77.77);
        X140_SeedLine('PM02', 1, 'Item P', 2.3);
        X140_SeedLine('PM02', 2, 'Item Q', 5.7);
        X140_SeedLine('PM02', 3, 'Item S', 1.9);
        X140_SeedLine('PM02', 4, 'Item R', 3.1);

        Allocator.AllocateRebate('PM01');
        Allocator.AllocateRebate('PM02');

        // Item P and Item Q are entered in the same position on both
        // documents, so their assertions alone already pin an unambiguous
        // per-item split for this set of weights and total.
        Assert.AreEqual(13.76, X140_GetLineAmount('PM01', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM01', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM01', 3), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM01', 4), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');

        Assert.AreEqual(13.76, X140_GetLineAmount('PM02', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM02', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM02', 3), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM02', 4), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');

        // Item R and Item S get the same amount no matter which line
        // number they were entered on - the split must not depend on the
        // order the lines were imported in.
        Assert.AreEqual(X140_GetLineAmount('PM01', 3), X140_GetLineAmount('PM02', 4), 'Expected Item R to receive the same rebate amount whichever line number it was entered on');
        Assert.AreEqual(X140_GetLineAmount('PM01', 4), X140_GetLineAmount('PM02', 3), 'Expected Item S to receive the same rebate amount whichever line number it was entered on');

        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM01'), 'Expected the recorded amounts to sum to exactly the document total');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM02'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ALineWithNoWeightAtAllOnTheWholeDocumentIsLeftUnallocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('NW01', 50.00);
        X140_SeedLineWithSentinel('NW01', 1, 0, 555.55);
        X140_SeedLineWithSentinel('NW01', 2, 0, 444.44);

        Allocator.AllocateRebate('NW01');

        RebateHeader.Get('NW01');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected a document with no weight on any line to be left unallocated');
        Assert.AreEqual(555.55, X140_GetLineAmount('NW01', 1), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
        Assert.AreEqual(444.44, X140_GetLineAmount('NW01', 2), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
    end;

    [Test]
    procedure X140_SuccessfulAllocationMarksTheDocumentAllocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('MK01', 40.00);
        X140_SeedLine('MK01', 1, 'Widget A', 1);
        X140_SeedLine('MK01', 2, 'Widget B', 1);

        Allocator.AllocateRebate('MK01');

        RebateHeader.Get('MK01');
        Assert.IsTrue(RebateHeader.Allocated, 'Expected a document with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure X140_DeterministicSweepMatchesTheReferenceAllocationAcrossManyPartitions()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
        Any: Codeunit Any;
        LineNo: array[10] of Integer;
        Weight: array[10] of Decimal;
        ExpectedShare: array[10] of Decimal;
        DocumentNo: Code[20];
        TotalAmount: Decimal;
        SumOfAmounts: Decimal;
        LineCount: Integer;
        Partition: Integer;
        i: Integer;
    begin
        Any.SetSeed(140);

        for Partition := 1 to 8 do begin
            X140_ClearAllData();
            DocumentNo := 'SW' + Format(Partition);
            LineCount := Any.IntegerInRange(3, 9);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            X140_SeedHeader(DocumentNo, TotalAmount);

            for i := 1 to LineCount do begin
                LineNo[i] := i;
                // Roughly every fourth line on a sweep partition is a
                // free-of-charge sample carrying no allocation weight.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                X140_SeedLine(DocumentNo, i, StrSubstNo('Sweep line %1', i), Weight[i]);
            end;

            Allocator.AllocateRebate(DocumentNo);
            X140_ComputeExpectedShares(Weight, LineNo, LineCount, TotalAmount, ExpectedShare);

            SumOfAmounts := 0;
            for i := 1 to LineCount do begin
                Assert.AreEqual(
                  ExpectedShare[i], X140_GetLineAmount(DocumentNo, LineNo[i]),
                  StrSubstNo('Expected line %1 of sweep partition %2 to depend only on that document''s own weights and total', LineNo[i], Partition));
                SumOfAmounts += X140_GetLineAmount(DocumentNo, LineNo[i]);
            end;
            Assert.AreEqual(
              TotalAmount, SumOfAmounts,
              StrSubstNo('Expected the recorded amounts on sweep partition %1 to sum to exactly its total', Partition));
        end;
    end;
}
