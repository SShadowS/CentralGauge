codeunit 89500 "CG-AL-X278 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 8 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears both tables before seeding its own rows. Each test
        // also uses its own Batch Code so seeding never collides with another
        // test's rows even before the clear runs.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // every test clears both tables before seeding its own rows. Grades are
        // random text rather than fixed literals so a fix cannot special-case a
        // hardcoded value.
        // Default test isolation persists writes between test methods, so every
        // test clears both tables before seeding its own rows.
        // (measured 2026-08-20, SOAP runner), so every record-driven test
        // clears the table before seeding its own rows. Untouched claims are
        // seeded with a nonzero sentinel amount so "untouched" and
        // "recalculated to zero" stay distinguishable.
        LedgerMgt: Codeunit "CG X163 Ledger Mgt";
        GroupTotals: Codeunit "CG X163 Group Totals";
        // Companies are enumerated at runtime, never hardcoded, and every test
        // that touches the other company deletes what it seeded there BEFORE
        // asserting anything, then Commit()s that delete - so the cleanup is
        // durable even if a later assertion in the same test fails and raises
        // an error. A defensive clear also runs at the start of every
        // cross-company test in case a still-earlier run was aborted before it
        // could self-heal.

    // ==========================================================
    // X070 - donor CG-AL-X070
    // ==========================================================

    local procedure X070_Reset()
    var
        ImportLine: Record "CG X070 Import Line";
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        ImportLine.DeleteAll();
        ImportedOrder.DeleteAll();
    end;

    local procedure X070_CreateLine(BatchCode: Code[20]; LineNo: Integer; CustomerNo: Code[20]; LineQuantity: Decimal)
    begin
        X070_CreateLine(BatchCode, LineNo, CustomerNo, LineQuantity, "CG X070 Import Status"::Pending);
    end;

    local procedure X070_CreateLine(BatchCode: Code[20]; LineNo: Integer; CustomerNo: Code[20]; LineQuantity: Decimal; LineStatus: Enum "CG X070 Import Status")
    var
        ImportLine: Record "CG X070 Import Line";
    begin
        ImportLine.Init();
        ImportLine."Batch Code" := BatchCode;
        ImportLine."Line No." := LineNo;
        ImportLine."Customer No." := CustomerNo;
        ImportLine.Quantity := LineQuantity;
        ImportLine.Status := LineStatus;
        ImportLine.Insert();
    end;

    local procedure X070_ImportedOrderCount(BatchCode: Code[20]): Integer
    var
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        ImportedOrder.SetRange("Batch Code", BatchCode);
        exit(ImportedOrder.Count());
    end;

    local procedure X070_ImportedOrderExists(BatchCode: Code[20]; LineNo: Integer): Boolean
    var
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        exit(ImportedOrder.Get(BatchCode, LineNo));
    end;

    local procedure X070_AssertLineHasStatus(BatchCode: Code[20]; LineNo: Integer; ExpectedStatus: Enum "CG X070 Import Status"; Msg: Text)
    var
        ImportLine: Record "CG X070 Import Line";
    begin
        Assert.IsTrue(ImportLine.Get(BatchCode, LineNo), StrSubstNo('Expected line %1 of batch %2 to still exist', LineNo, BatchCode));
        Assert.AreEqual(Format(ExpectedStatus), Format(ImportLine.Status), Msg);
    end;

    local procedure X070_AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the error to mention "%1", got: %2', Fragment, ActualError));
    end;

    [Test]
    procedure X070_AllPendingLinesOfTheBatchAreImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
    begin
        X070_Reset();
        X070_CreateLine('X70-T01', 10, 'CUST-A', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine('X70-T01', 20, 'CUST-B', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine('X70-T01', 30, 'CUST-C', Any.DecimalInRange(1, 500, 2));

        ImportBatch.ImportBatch('X70-T01');

        Assert.AreEqual(3, X070_ImportedOrderCount('X70-T01'), 'Expected exactly one imported order per pending line of a clean batch');
        X070_AssertLineHasStatus('X70-T01', 10, "CG X070 Import Status"::Imported, 'Line 10 must be marked imported');
        X070_AssertLineHasStatus('X70-T01', 20, "CG X070 Import Status"::Imported, 'Line 20 must be marked imported');
        X070_AssertLineHasStatus('X70-T01', 30, "CG X070 Import Status"::Imported, 'Line 30 must be marked imported');
    end;

    [Test]
    procedure X070_ImportCopiesCustomerAndQuantityToTheImportedOrder()
    var
        ImportedOrder: Record "CG X070 Imported Order";
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
        CustomerNo: Code[20];
        LineQuantity: Decimal;
    begin
        X070_Reset();
        CustomerNo := CopyStr('X70-' + UpperCase(Any.AlphabeticText(10)), 1, 20);
        LineQuantity := Any.DecimalInRange(1, 900, 2);
        X070_CreateLine('X70-T02', 10, CustomerNo, LineQuantity);

        ImportBatch.ImportBatch('X70-T02');

        Assert.IsTrue(ImportedOrder.Get('X70-T02', 10), 'Expected an imported order for the imported line');
        Assert.AreEqual(CustomerNo, ImportedOrder."Customer No.", 'Expected the line''s customer to carry over to the imported order');
        Assert.AreEqual(LineQuantity, ImportedOrder.Quantity, 'Expected the line''s quantity to carry over to the imported order');
    end;

    [Test]
    procedure X070_ALineWithNoCustomerFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T03', 10, '', 5);
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T03');

        X070_AssertErrorContains('Customer No.');
        X070_AssertErrorContains('must have a value');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T03', 10), 'Expected no imported order for a line missing its customer');
        X070_AssertLineHasStatus('X70-T03', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    [Test]
    procedure X070_AZeroQuantityLineFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T04', 10, 'CUST-A', 0);
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T04');

        X070_AssertErrorContains('must be positive');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T04', 10), 'Expected no imported order for a zero-quantity line');
        X070_AssertLineHasStatus('X70-T04', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    [Test]
    procedure X070_ANegativeQuantityLineFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
    begin
        X070_Reset();
        X070_CreateLine('X70-T05', 10, 'CUST-A', -Any.DecimalInRange(1, 500, 2));
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T05');

        X070_AssertErrorContains('must be positive');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T05', 10), 'Expected no imported order for a negative-quantity line');
        X070_AssertLineHasStatus('X70-T05', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    local procedure X070_SeedPoisonedBatch(BatchCode: Code[20])
    var
        Any: Codeunit Any;
    begin
        X070_CreateLine(BatchCode, 10, 'CUST-A', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine(BatchCode, 20, 'CUST-B', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine(BatchCode, 30, '', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine(BatchCode, 40, 'CUST-D', Any.DecimalInRange(1, 500, 2));
        // Committed so the failing run's own error can only affect what the
        // run itself writes, never this test's own arrangement.
        Commit();
    end;

    [Test]
    procedure X070_LinesImportedBeforeAFailingLineSurviveTheRun()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_SeedPoisonedBatch('X70-T06');

        asserterror ImportBatch.ImportBatch('X70-T06');

        X070_AssertErrorContains('must have a value');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T06', 10),
            'Expected the imported order of line 10 to still exist after a later line in the same run failed');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T06', 20),
            'Expected the imported order of line 20 to still exist after a later line in the same run failed');
        X070_AssertLineHasStatus('X70-T06', 10, "CG X070 Import Status"::Imported, 'Line 10 must remain marked imported after a later line failed');
        X070_AssertLineHasStatus('X70-T06', 20, "CG X070 Import Status"::Imported, 'Line 20 must remain marked imported after a later line failed');
    end;

    [Test]
    procedure X070_TheFailingLineAndItsSuccessorAreNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_SeedPoisonedBatch('X70-T07');

        asserterror ImportBatch.ImportBatch('X70-T07');

        X070_AssertErrorContains('must have a value');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T07', 30), 'Expected no imported order for the line that failed its own guard');
        X070_AssertLineHasStatus('X70-T07', 30, "CG X070 Import Status"::Pending, 'The failing line itself must stay pending');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T07', 40), 'Expected no imported order for the line after the one that failed - the run must stop there');
        X070_AssertLineHasStatus('X70-T07', 40, "CG X070 Import Status"::Pending, 'The line after the failing one must stay untouched');
    end;

    [Test]
    procedure X070_RepairedBatchResumesWithoutDuplicatingEarlierLines()
    var
        ImportLine: Record "CG X070 Import Line";
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_SeedPoisonedBatch('X70-T08');
        asserterror ImportBatch.ImportBatch('X70-T08');
        ImportLine.Get('X70-T08', 30);
        ImportLine."Customer No." := 'CUST-FIX';
        ImportLine.Modify();
        Commit();

        ImportBatch.ImportBatch('X70-T08');

        Assert.AreEqual(4, X070_ImportedOrderCount('X70-T08'),
            'Expected the repaired rerun to leave exactly one imported order per line - no duplicates for lines imported on the earlier run');
        X070_AssertLineHasStatus('X70-T08', 10, "CG X070 Import Status"::Imported, 'Line 10 must be imported');
        X070_AssertLineHasStatus('X70-T08', 20, "CG X070 Import Status"::Imported, 'Line 20 must be imported');
        X070_AssertLineHasStatus('X70-T08', 30, "CG X070 Import Status"::Imported, 'The repaired line must be imported');
        X070_AssertLineHasStatus('X70-T08', 40, "CG X070 Import Status"::Imported, 'The line after the repaired one must be imported');
    end;

    [Test]
    procedure X070_ImportOnlyAffectsLinesOfTheGivenBatch()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T09A', 10, 'CUST-A', 10);
        X070_CreateLine('X70-T09A', 20, 'CUST-B', 20);
        X070_CreateLine('X70-T09B', 10, '', 5);

        ImportBatch.ImportBatch('X70-T09A');

        Assert.AreEqual(2, X070_ImportedOrderCount('X70-T09A'), 'Expected both lines of the given batch to be imported');
        Assert.AreEqual(0, X070_ImportedOrderCount('X70-T09B'), 'Expected a neighbour batch to be left untouched by importing a different batch');
        X070_AssertLineHasStatus('X70-T09B', 10, "CG X070 Import Status"::Pending, 'A neighbour batch''s line must stay pending');
    end;

    [Test]
    procedure X070_AlreadyImportedLinesAreNotReprocessed()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T10', 10, 'CUST-A', 5, "CG X070 Import Status"::Imported);
        X070_CreateLine('X70-T10', 20, 'CUST-B', 7);

        ImportBatch.ImportBatch('X70-T10');

        Assert.IsFalse(X070_ImportedOrderExists('X70-T10', 10), 'Expected no new imported order for a line already marked imported');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T10', 20), 'Expected the pending line to be imported');
    end;

    [Test]
    procedure X070_EmptyBatchIsAQuietNoOp()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();

        ImportBatch.ImportBatch('X70-T11');

        Assert.AreEqual(0, X070_ImportedOrderCount('X70-T11'), 'Expected a batch with no pending lines to import nothing');
    end;

    [Test]
    procedure X070_ALineThatFailsToWriteStillSparesItsPredecessors()
    var
        ImportedOrder: Record "CG X070 Imported Order";
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T12', 10, 'CUST-A', 10);
        X070_CreateLine('X70-T12', 20, 'CUST-B', 20);
        X070_CreateLine('X70-T12', 30, 'CUST-C', 30);
        X070_CreateLine('X70-T12', 40, 'CUST-D', 40);
        // A stray imported order already occupies line 30's key, so its own
        // Insert fails - not a guard error, a write-time error.
        ImportedOrder.Init();
        ImportedOrder."Batch Code" := 'X70-T12';
        ImportedOrder."Line No." := 30;
        ImportedOrder."Customer No." := 'STRAY';
        ImportedOrder.Quantity := 1;
        ImportedOrder.Insert();
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T12');

        X070_AssertErrorContains('already exists');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T12', 10),
            'Expected the imported order of line 10 to still exist after a later line crashed while writing its own imported order');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T12', 20),
            'Expected the imported order of line 20 to still exist after a later line crashed while writing its own imported order');
        X070_AssertLineHasStatus('X70-T12', 10, "CG X070 Import Status"::Imported, 'Line 10 must remain marked imported');
        X070_AssertLineHasStatus('X70-T12', 20, "CG X070 Import Status"::Imported, 'Line 20 must remain marked imported');
        X070_AssertLineHasStatus('X70-T12', 30, "CG X070 Import Status"::Pending, 'The line that crashed while writing must stay pending');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T12', 40), 'Expected no imported order for the line after the one that crashed - the run must stop there');
    end;

    // ==========================================================
    // X075 - donor CG-AL-X075
    // ==========================================================

    local procedure X075_SeedContact(ContactNo: Code[20]; CityName: Text[30]; ContactCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Contact.Init();
        Contact."No." := ContactNo;
        Contact.City := CityName;
        Contact."Credit Limit" := ContactCreditLimit;
        Contact.Insert();
    end;

    // Walks the view the submission left on the record; called repeatedly per
    // test, which also proves the list survives being iterated more than once.
    local procedure X075_CountVisits(var Contact: Record "CG X075 Contact"; ContactNo: Code[20]): Integer
    var
        Visits: Integer;
    begin
        if Contact.FindSet() then
            repeat
                if Contact."No." = ContactNo then
                    Visits += 1;
            until Contact.Next() = 0;
        exit(Visits);
    end;

    local procedure X075_AssertContactUnchanged(ContactNo: Code[20]; ExpectedCity: Text[30]; ExpectedCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Assert.IsTrue(Contact.Get(ContactNo),
            StrSubstNo('Expected contact %1 to still exist under its original number after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCity, Contact.City,
            StrSubstNo('Expected contact %1''s city to be unchanged after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCreditLimit, Contact."Credit Limit",
            StrSubstNo('Expected contact %1''s credit limit to be unchanged after building the call list', ContactNo));
    end;

    [Test]
    procedure X075_CityOnlyQualifiersAppearOnTheList()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C001', 'RIVERTON', 0);
        X075_SeedContact('C002', 'RIVERTON', 0);
        X075_SeedContact('C003', 'LAKESIDE', 0);

        CampaignCallList.BuildCallList(Contact, 'RIVERTON', 100000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C001'),
            'Expected a contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C002'),
            'Expected a second contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C003'),
            'Expected a contact outside the target city, below the credit limit, to stay off the call list');
    end;

    [Test]
    procedure X075_CreditLimitQualifiersAppearRegardlessOfCity()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C010', 'FARAWAY', 3200);
        X075_SeedContact('C011', 'FARAWAY', 1800);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 2500);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C010'),
            'Expected a contact whose credit limit clears the threshold to be on the call list even though they live outside the target city');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C011'),
            'Expected a contact below the credit-limit threshold and outside the target city to stay off the call list');
    end;

    [Test]
    procedure X075_ContactMatchingBothRulesIsVisitedOnceAlongsideCityOnlyContact()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C020', 'HARBORVIEW', 5200);
        X075_SeedContact('C021', 'HARBORVIEW', 0);
        X075_SeedContact('C022', 'MILLBROOK', 5200);

        CampaignCallList.BuildCallList(Contact, 'HARBORVIEW', 4000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C020'),
            'Expected a contact matching both rules to be visited exactly once, nobody gets called twice');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C021'),
            'Expected a contact matching only the target-city rule to be on the same list as a contact matching both rules');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C022'),
            'Expected a contact matching only the credit-limit rule to be on the same list as a contact matching both rules');
    end;

    [Test]
    procedure X075_CreditLimitThresholdBoundaryQualifiesAtExactValue()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C030', 'RIVERSIDE', 4000);
        X075_SeedContact('C031', 'RIVERSIDE', 3999.99);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 4000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C030'),
            'Expected a credit limit exactly at the threshold to qualify, the rule is at or above the threshold, not strictly above it');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C031'),
            'Expected a credit limit just below the threshold to stay off the call list');
    end;

    [Test]
    procedure X075_TargetCityMatchesTheWholeValueOnly()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C040', 'NORTH', 0);
        X075_SeedContact('C041', 'NORTHPORT', 0);

        CampaignCallList.BuildCallList(Contact, 'NORTH', 100000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C040'),
            'Expected a contact whose city exactly matches the target city to be on the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C041'),
            'Expected a contact whose city merely starts with the target city to stay off the list, the match is on the whole value');
    end;

    [Test]
    procedure X075_BuildingTheListWritesNoContacts()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C050', 'CAMPAIGNTOWN', 900);
        X075_SeedContact('C051', 'QUIETSIDE', 900);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 5000);

        Assert.AreEqual(0, X075_CountVisits(Contact, 'C051'),
            'Expected a contact matching neither rule to stay off the call list');
        X075_AssertContactUnchanged('C050', 'CAMPAIGNTOWN', 900);
        X075_AssertContactUnchanged('C051', 'QUIETSIDE', 900);
    end;

    [Test]
    procedure X075_CampaignLookupBuildsTheSameCallListThroughTheWrapper()
    var
        Contact: Record "CG X075 Contact";
        Campaign: Record "CG X075 Campaign";
        CampaignCallListMgt: Codeunit "CG X075 Campaign Call List Mgt";
    begin
        Contact.DeleteAll();
        Campaign.DeleteAll();
        X075_SeedContact('C060', 'ELM STREET', 0);
        X075_SeedContact('C061', 'MAPLE STREET', 0);

        Campaign.Init();
        Campaign."Code" := 'SPRING26';
        Campaign."Target City" := 'ELM STREET';
        Campaign."Minimum Credit Limit" := 100000;
        Campaign.Insert();

        CampaignCallListMgt.BuildCallListForCampaign(Contact, 'SPRING26');

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C060'),
            'Expected the campaign lookup to include a contact in the campaign''s target city on the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C061'),
            'Expected the campaign lookup to leave a contact in a different city off the call list');
    end;

    // ==========================================================
    // X081 - donor CG-AL-X081
    // ==========================================================

    local procedure X081_Reset()
    var
        OrderLine: Record "CG X081 Order Line";
        Item: Record "CG X081 Item";
    begin
        OrderLine.DeleteAll();
        Item.DeleteAll();
    end;

    local procedure X081_CreateItem(var Item: Record "CG X081 Item"; No: Code[20]; Grade: Code[10])
    begin
        Item.Init();
        Item."No." := No;
        Item."Quality Grade" := Grade;
        Item.Insert(true);
    end;

    local procedure X081_RandomGrade(var Any: Codeunit Any): Code[10]
    begin
        exit(CopyStr(Any.AlphabeticText(10), 1, 10));
    end;

    local procedure X081_CreateLine(var OrderLine: Record "CG X081 Order Line"; EntryNo: Integer; ItemNo: Code[20])
    begin
        OrderLine.Init();
        OrderLine."Entry No." := EntryNo;
        OrderLine.Insert(true);
        OrderLine.Validate("Item No.", ItemNo);
        OrderLine.Modify(true);
    end;

    [Test]
    procedure X081_NewLineForAGradedItemGetsTheGrade()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Grade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        Grade := X081_RandomGrade(Any);
        X081_CreateItem(Item, 'ITEM-A', Grade);

        X081_CreateLine(OrderLine, 1, Item."No.");

        Assert.AreEqual(Grade, OrderLine."Quality Grade",
            'Expected validating "Item No." with a graded item to copy that item''s grade onto the line');
    end;

    [Test]
    procedure X081_NewLineForAGradelessItemStaysBlank()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        X081_Reset();
        X081_CreateItem(Item, 'ITEM-B', '');

        X081_CreateLine(OrderLine, 2, Item."No.");

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to stay blank when the item on it has none');
    end;

    [Test]
    procedure X081_RevalidatingToAnotherGradedItemOverwritesTheGrade()
    var
        FirstItem: Record "CG X081 Item";
        SecondItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(FirstItem, 'ITEM-C', X081_RandomGrade(Any));
        SecondGrade := X081_RandomGrade(Any);
        X081_CreateItem(SecondItem, 'ITEM-D', SecondGrade);
        X081_CreateLine(OrderLine, 3, FirstItem."No.");

        OrderLine.Validate("Item No.", SecondItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." to another graded item to overwrite the line''s grade with the new item''s grade');
    end;

    [Test]
    procedure X081_RevalidatingToAGradelessItemClearsTheLine()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-E', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-F', '');
        X081_CreateLine(OrderLine, 4, GradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to an item with no grade - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure X081_ClearingTheItemNoAlsoClearsTheGrade()
    var
        GradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-M', X081_RandomGrade(Any));
        X081_CreateLine(OrderLine, 8, GradedItem."No.");

        OrderLine.Validate("Item No.", '');
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to blank - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure X081_RevalidatingBackToAGradedItemAfterClearingSetsTheNewGrade()
    var
        FirstGradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        SecondGradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(FirstGradedItem, 'ITEM-G', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-H', '');
        SecondGrade := X081_RandomGrade(Any);
        X081_CreateItem(SecondGradedItem, 'ITEM-I', SecondGrade);
        X081_CreateLine(OrderLine, 5, FirstGradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);
        OrderLine.Validate("Item No.", SecondGradedItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." back to a graded item after a gradeless item to set the new item''s grade');
    end;

    [Test]
    procedure X081_AssigningItemValuesDirectlyAlsoClearsAStaleGrade()
    var
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        LineDefaultsMgt: Codeunit "CG X081 Line Defaults Mgt";
    begin
        X081_Reset();
        X081_CreateItem(GradelessItem, 'ITEM-J', '');
        OrderLine.Init();
        OrderLine."Entry No." := 6;
        OrderLine."Item No." := GradelessItem."No.";
        OrderLine."Quality Grade" := 'STALE';
        OrderLine.Insert(true);

        LineDefaultsMgt.AssignItemValues(OrderLine);
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected assigning item values for a line pointed at a gradeless item to leave the line''s grade blank, matching what that item carries');
    end;

    [Test]
    procedure X081_UnrelatedLinesAreNeverTouched()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        OtherLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-K', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-L', '');

        OtherLine.Init();
        OtherLine."Entry No." := 100;
        OtherLine."Quality Grade" := 'SENTINEL9';
        OtherLine.Insert(true);

        X081_CreateLine(OrderLine, 7, GradedItem."No.");
        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        OtherLine.Get(100);
        Assert.AreEqual('SENTINEL9', Format(OtherLine."Quality Grade"),
            'Expected a line never re-validated in this test to keep its original grade untouched');
    end;

    // ==========================================================
    // X093 - donor CG-AL-X093
    // ==========================================================

    local procedure X093_ClearData()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        OrderLine.DeleteAll();
        Order.DeleteAll();
    end;

    local procedure X093_SeedOrder(OrderNo: Code[20]; CustomerNo: Code[20]; OrderDate: Date; var Order: Record "CG X093 Order")
    begin
        Order.Init();
        Order."No." := OrderNo;
        Order."Customer No." := CustomerNo;
        Order."Order Date" := OrderDate;
        Order.Insert();
    end;

    local procedure X093_SeedLine(OrderNo: Code[20]; LineNo: Integer; ItemNo: Code[20]; LineDescription: Text[100]; Qty: Decimal; UnitPrice: Decimal; LineAmount: Decimal; var OrderLine: Record "CG X093 Order Line")
    begin
        OrderLine.Init();
        OrderLine."Order No." := OrderNo;
        OrderLine."Line No." := LineNo;
        OrderLine."Item No." := ItemNo;
        OrderLine.Description := LineDescription;
        OrderLine.Quantity := Qty;
        OrderLine."Unit Price" := UnitPrice;
        OrderLine."Line Amount" := LineAmount;
        OrderLine.Insert();
    end;

    local procedure X093_ParseExport(Order: Record "CG X093 Order") OrderObject: JsonObject
    var
        OrderExport: Codeunit "CG X093 Order Export";
        Payload: Text;
    begin
        Payload := OrderExport.ExportOrder(Order);
        Assert.IsTrue(OrderObject.ReadFrom(Payload),
            StrSubstNo('Expected ExportOrder to return well-formed JSON, but a parser rejected: %1', Payload));
    end;

    local procedure X093_GetProperty(JsonObj: JsonObject; PropertyName: Text) Token: JsonToken
    begin
        Assert.IsTrue(JsonObj.Get(PropertyName, Token),
            StrSubstNo('Expected the exported document to contain a "%1" property', PropertyName));
    end;

    local procedure X093_GetLine(OrderObject: JsonObject; Index: Integer) LineObject: JsonObject
    var
        LinesToken: JsonToken;
        LineToken: JsonToken;
    begin
        LinesToken := X093_GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.IsTrue(LinesToken.AsArray().Get(Index, LineToken),
            StrSubstNo('Expected the "lines" array to have an element at index %1', Index));
        Assert.IsTrue(LineToken.IsObject(), StrSubstNo('Expected element %1 of the "lines" array to be a JSON object', Index));
        LineObject := LineToken.AsObject();
    end;

    local procedure X093_AssertTextProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Text)
    var
        Token: JsonToken;
    begin
        Token := X093_GetProperty(JsonObj, PropertyName);
        Assert.AreEqual(Expected, Token.AsValue().AsText(),
            StrSubstNo('Expected the "%1" property to carry the exact value from the order', PropertyName));
    end;

    local procedure X093_AssertNumberProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Decimal)
    var
        Token: JsonToken;
        RawValue: Text;
    begin
        Token := X093_GetProperty(JsonObj, PropertyName);
        Assert.IsTrue(Token.IsValue(), StrSubstNo('Expected the "%1" property to be a plain JSON value, not an object or array', PropertyName));
        Token.WriteTo(RawValue);
        Assert.IsFalse(RawValue.StartsWith('"'),
            StrSubstNo('Expected the "%1" property to be an unquoted JSON number, but it serialized as %2', PropertyName, RawValue));
        Assert.AreEqual(Expected, Token.AsValue().AsDecimal(),
            StrSubstNo('Expected the "%1" property to carry the value from the order line', PropertyName));
    end;

    [Test]
    procedure X093_ExportedDocumentIsWellFormedJson()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        X093_ClearData();
        X093_SeedOrder('SO-1001', 'C-1000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        X093_ParseExport(Order);
    end;

    [Test]
    procedure X093_HeaderFieldsRoundTripToTheExportedDocument()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-2001', 'C-2000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := X093_ParseExport(Order);

        X093_AssertTextProperty(OrderObject, 'orderNo', Order."No.");
        X093_AssertTextProperty(OrderObject, 'customerNo', Order."Customer No.");
    end;

    [Test]
    procedure X093_OrderDateWithSingleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-3001', 'C-3000', DMY2Date(5, 1, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := X093_ParseExport(Order);

        DateToken := X093_GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-01-05', DateToken.AsValue().AsText(),
            'Expected the order date January 5, 2026 to serialize as 2026-01-05');
    end;

    [Test]
    procedure X093_OrderDateWithDoubleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-3002', 'C-3001', DMY2Date(23, 11, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := X093_ParseExport(Order);

        DateToken := X093_GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-11-23', DateToken.AsValue().AsText(),
            'Expected the order date November 23, 2026 to serialize as 2026-11-23');
    end;

    [Test]
    procedure X093_UnitPriceSerializesAsAPlainJsonNumberNotAText()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-4001', 'C-4000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 3, 1249.99, 3749.97, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertNumberProperty(LineObject, 'unitPrice', OrderLine."Unit Price");
    end;

    [Test]
    procedure X093_QuantityAndLineAmountSerializeAsPlainJsonNumbers()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-5001', 'C-5000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 4.5, 20, 91.35, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertNumberProperty(LineObject, 'lineNo', OrderLine."Line No.");
        X093_AssertNumberProperty(LineObject, 'quantity', OrderLine.Quantity);
        X093_AssertNumberProperty(LineObject, 'lineAmount', OrderLine."Line Amount");
    end;

    [Test]
    procedure X093_LineAmountIsTheStoredValueNotARecomputation()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-6001', 'C-6000', DMY2Date(15, 6, 2026), Order);
        // Line Amount deliberately does not equal Quantity * Unit Price, so a
        // recomputed export would disagree with the stored value.
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 10, 100, 850, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertNumberProperty(LineObject, 'lineAmount', 850);
    end;

    [Test]
    procedure X093_LinesArrayCoversOnlyThisOrdersOwnLinesInLineNoOrder()
    var
        Order: Record "CG X093 Order";
        OtherOrder: Record "CG X093 Order";
        FirstLine: Record "CG X093 Order Line";
        SecondLine: Record "CG X093 Order Line";
        OtherLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-7001', 'C-7000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 20000, 'ITM-2', 'Second line', 1, 50, 50, SecondLine);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'First line', 1, 40, 40, FirstLine);
        X093_SeedOrder('SO-7002', 'C-7001', DMY2Date(15, 6, 2026), OtherOrder);
        X093_SeedLine(OtherOrder."No.", 10000, 'ITM-3', 'Other order line', 1, 10, 10, OtherLine);

        OrderObject := X093_ParseExport(Order);

        LinesToken := X093_GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.AreEqual(2, LinesToken.AsArray().Count(),
            'Expected the "lines" array to contain only this order''s own lines, in ascending line number order');
        X093_AssertTextProperty(X093_GetLine(OrderObject, 0), 'itemNo', FirstLine."Item No.");
        X093_AssertTextProperty(X093_GetLine(OrderObject, 1), 'itemNo', SecondLine."Item No.");
    end;

    [Test]
    procedure X093_DescriptionsWithQuotesAndBackslashesRoundTripUnchanged()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
        HostileDescription: Text[100];
    begin
        X093_ClearData();
        HostileDescription := '24" bracket \ steel "premium"';
        X093_SeedOrder('SO-8001', 'C-8000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', HostileDescription, 1, 40, 40, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertTextProperty(LineObject, 'description', HostileDescription);
    end;

    [Test]
    procedure X093_OrderWithoutLinesSerializesAnEmptyLinesArray()
    var
        Order: Record "CG X093 Order";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-9001', 'C-9000', DMY2Date(15, 6, 2026), Order);

        OrderObject := X093_ParseExport(Order);

        LinesToken := X093_GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array even for an order without lines');
        Assert.AreEqual(0, LinesToken.AsArray().Count(), 'Expected an empty "lines" array for an order without lines');
    end;

    // ==========================================================
    // X114 - donor CG-AL-X114
    // ==========================================================

    local procedure X114_Seed(EntryNo: Integer; AwayMinutes: Integer; InitialAmount: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Init();
        Claim."Entry No." := EntryNo;
        Claim."Away Minutes" := AwayMinutes;
        Claim."Allowance Amount" := InitialAmount;
        Claim.Insert();
    end;

    local procedure X114_Recalc(EntryNo: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Claim.Get(EntryNo);
        AllowanceCalc.RecalculateClaim(Claim);
    end;

    local procedure X114_AmountOf(EntryNo: Integer): Integer
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Get(EntryNo);
        exit(Claim."Allowance Amount");
    end;

    // Independent reference ladder the sweeps below grade against -
    // deliberately not shared with the application code under test.
    local procedure X114_ExpectedAmountFor(AwayMinutes: Integer): Integer
    begin
        if AwayMinutes >= 720 then
            exit(500);
        if AwayMinutes > 360 then
            exit(250);
        exit(0);
    end;

    [Test]
    procedure X114_CalculatedAmountsMatchTheConfirmedBandNearSixHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 350 to 370 do
            Assert.AreEqual(
              X114_ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure X114_CalculatedAmountsMatchTheConfirmedBandNearTwelveHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 710 to 730 do
            Assert.AreEqual(
              X114_ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure X114_TheShortestAndLongestTripsResolveToTheOuterTiers()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(-30), 'A negative away-time must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(0), 'A zero-minute trip must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(1), 'A 1-minute trip must resolve to no allowance');
        Assert.AreEqual(500, AllowanceCalc.CalculateAllowance(1440), 'A 1440-minute trip must resolve to the full allowance');
    end;

    [Test]
    procedure X114_TheOvertimeBandClassificationStaysCorrect()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(200), 'A 200-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(500), 'A 500-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(800), 'An 800-minute trip must classify into the full-allowance band');

        // The statistics classification must keep matching the confirmed
        // amount schedule at the same away-times CalculateAllowance is
        // graded on - a rewrite that simplifies away how OvertimeBandOf
        // decides each side of these away-times must not go ungraded.
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(359), 'A 359-minute trip must classify into the no-allowance band');
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(360), 'A 360-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(361), 'A 361-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(719), 'A 719-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(720), 'A 720-minute trip must classify into the full-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(721), 'A 721-minute trip must classify into the full-allowance band');
    end;

    [Test]
    procedure X114_RecalculatingAClaimWritesTheConfirmedAmountBackToTheRecord()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(1, 500, 999);

        X114_Recalc(1);

        Assert.AreEqual(250, X114_AmountOf(1), 'Recalculating a claim must store the confirmed allowance amount back onto the claim');
    end;

    [Test]
    procedure X114_RecalculatingOneClaimLeavesOtherClaimsUntouched()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(2, 500, 999);
        X114_Seed(3, 800, 777);

        X114_Recalc(2);

        Assert.AreEqual(250, X114_AmountOf(2), 'The recalculated claim must resolve to the confirmed allowance amount');
        Assert.AreEqual(777, X114_AmountOf(3), 'A claim that was not recalculated must keep its existing allowance amount');
    end;

    [Test]
    procedure X114_RecalculatingTheSameClaimTwiceIsStable()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(4, 500, 0);

        X114_Recalc(4);
        X114_Recalc(4);

        Assert.AreEqual(250, X114_AmountOf(4), 'Recalculating the same claim twice must not change the result');
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

    // ==========================================================
    // X160 - donor CG-AL-X160
    // ==========================================================

    local procedure X160_ClearFixture()
    var
        Wallet: Record "CG X160 Wallet";
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        Wallet.DeleteAll();
        WalletEntry.DeleteAll();
    end;

    local procedure X160_SeedWallet(No: Code[20]; Balance: Decimal)
    var
        Wallet: Record "CG X160 Wallet";
    begin
        Wallet.Init();
        Wallet."No." := No;
        Wallet.Balance := Balance;
        // Nonzero-checkable sentinel: an untouched wallet must keep this exactly.
        Wallet."Total Charged" := 0;
        Wallet.Insert();
    end;

    local procedure X160_EntryCountFor(WalletNo: Code[20]): Integer
    var
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        exit(WalletEntry.Count());
    end;

    local procedure X160_GetLastEntry(WalletNo: Code[20]; var WalletEntry: Record "CG X160 Wallet Entry")
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        Assert.IsTrue(WalletEntry.FindLast(), StrSubstNo('Expected at least one ledger entry for wallet %1', WalletNo));
    end;

    [Test]
    procedure X160_ChargingTakesMoneyOutAndUpdatesTheRunningTotal()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Entry: Record "CG X160 Wallet Entry";
    begin
        // [SCENARIO] A charge against a funded wallet succeeds
        X160_ClearFixture();
        X160_SeedWallet('W-01', 500);

        WalletMgt.PostCharge('W-01', 120);

        Wallet.Get('W-01');
        Assert.AreEqual(380.0, Wallet.Balance, 'Expected the charge to reduce the wallet''s balance');
        Assert.AreEqual(120.0, Wallet."Total Charged", 'Expected the charge to add to the wallet''s running total');
        X160_GetLastEntry('W-01', Entry);
        Assert.AreEqual(120.0, Entry.Amount, 'Expected the ledger entry to record the charged amount');
    end;

    [Test]
    procedure X160_ARefundOnOneWalletDoesNotShrinkAnotherWalletsRefundRoom()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Wallet: Record "CG X160 Wallet";
    begin
        // [SCENARIO] Refund room is per wallet, not shared across wallets
        X160_ClearFixture();
        X160_SeedWallet('W-RA', 500);
        X160_SeedWallet('W-RB', 500);
        WalletMgt.PostCharge('W-RA', 100);
        WalletMgt.PostCharge('W-RB', 100);

        WalletMgt.PostRefund('W-RA', 40);
        WalletMgt.PostRefund('W-RB', 100);

        Wallet.Get('W-RB');
        Assert.AreEqual(500.0, Wallet.Balance, 'A wallet''s refund room must not be reduced by another wallet''s refunds');
    end;

    [Test]
    procedure X160_ChargingMoreThanTheBalanceIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A charge larger than what is available is refused
        X160_ClearFixture();
        X160_SeedWallet('W-02', 100);

        asserterror WalletMgt.PostCharge('W-02', 100.01);

        Assert.ExpectedError('W-02');
    end;

    [Test]
    procedure X160_ChargingExactlyTheBalanceSucceeds()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A charge for exactly what is available is allowed
        X160_ClearFixture();
        X160_SeedWallet('W-03', 75);

        WalletMgt.PostCharge('W-03', 75);

        Wallet.Get('W-03');
        Assert.AreEqual(0.0, Wallet.Balance, 'Expected the wallet to be drawn down to zero exactly');
    end;

    [Test]
    procedure X160_ChargingANonPositiveAmountIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Zero and negative charge amounts are both rejected
        X160_ClearFixture();
        X160_SeedWallet('W-04', 500);
        Commit();

        asserterror WalletMgt.PostCharge('W-04', 0);
        Commit();
        asserterror WalletMgt.PostCharge('W-04', -10);
    end;

    [Test]
    procedure X160_ChargingAnUnknownWalletFails()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] There is no such wallet to charge
        X160_ClearFixture();

        asserterror WalletMgt.PostCharge('NOPE', 10);

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure X160_RefundingPutsMoneyBackWithoutTouchingTheRunningTotal()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Entry: Record "CG X160 Wallet Entry";
    begin
        // [SCENARIO] A refund against a charge that was made puts the money back
        X160_ClearFixture();
        X160_SeedWallet('W-05', 500);
        WalletMgt.PostCharge('W-05', 200);

        WalletMgt.PostRefund('W-05', 80);

        Wallet.Get('W-05');
        Assert.AreEqual(380.0, Wallet.Balance, 'Expected the refund to put the money back on the wallet''s balance');
        Assert.AreEqual(200.0, Wallet."Total Charged",
            'Expected the wallet''s running total to still reflect only what was charged');
        X160_GetLastEntry('W-05', Entry);
        Assert.AreEqual("CG X160 Entry Type"::Refund, Entry."Entry Type",
            'Expected the newest ledger entry to record a refund');
        Assert.AreEqual(80.0, Entry.Amount, 'Expected the ledger entry to record the refunded amount');
    end;

    [Test]
    procedure X160_RefundingWithNothingEverChargedIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A generously funded wallet that has never actually been charged
        X160_ClearFixture();
        X160_SeedWallet('W-06', 5000);

        asserterror WalletMgt.PostRefund('W-06', 50);

        Assert.ExpectedError('W-06');
    end;

    [Test]
    procedure X160_RefundsCannotExceedWhatWasActuallyCharged()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Two partial refunds are given back, then a third goes too far
        X160_ClearFixture();
        X160_SeedWallet('W-07', 1000);
        WalletMgt.PostCharge('W-07', 100);

        WalletMgt.PostRefund('W-07', 40);
        WalletMgt.PostRefund('W-07', 40);
        Commit();
        asserterror WalletMgt.PostRefund('W-07', 30);

        Wallet.Get('W-07');
        Assert.AreEqual(980.0, Wallet.Balance,
            'Expected only the two successful refunds to have reached the wallet''s balance');
        Assert.AreEqual(3, X160_EntryCountFor('W-07'), 'Expected the refused refund not to have added a ledger entry');
    end;

    [Test]
    procedure X160_ARefundForExactlyWhatRemainsSucceedsButNoMoreThanThatDoes()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A refund for precisely what remains is allowed; one cent more is not
        X160_ClearFixture();
        X160_SeedWallet('W-08', 1000);
        WalletMgt.PostCharge('W-08', 60);
        WalletMgt.PostRefund('W-08', 20);

        WalletMgt.PostRefund('W-08', 40);

        Wallet.Get('W-08');
        Assert.AreEqual(1000.0, Wallet.Balance, 'Expected the wallet to be made fully whole again');

        Commit();
        asserterror WalletMgt.PostRefund('W-08', 0.01);
    end;

    [Test]
    procedure X160_ANonPositiveRefundAmountIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Zero and negative refund amounts are both rejected
        X160_ClearFixture();
        X160_SeedWallet('W-10', 500);
        WalletMgt.PostCharge('W-10', 200);
        Commit();

        asserterror WalletMgt.PostRefund('W-10', 0);
        Commit();
        asserterror WalletMgt.PostRefund('W-10', -5);
    end;

    [Test]
    procedure X160_RefundingAnUnknownWalletFails()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] There is no such wallet to refund
        X160_ClearFixture();

        asserterror WalletMgt.PostRefund('NOPE', 10);

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure X160_RefundingOneWalletLeavesAnotherWalletsFiguresAlone()
    var
        WalletA: Record "CG X160 Wallet";
        WalletB: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Two wallets are charged and only one of them is refunded
        X160_ClearFixture();
        X160_SeedWallet('W-11A', 500);
        X160_SeedWallet('W-11B', 500);
        WalletMgt.PostCharge('W-11A', 100);
        WalletMgt.PostCharge('W-11B', 100);

        WalletMgt.PostRefund('W-11A', 40);

        WalletA.Get('W-11A');
        Assert.AreEqual(440.0, WalletA.Balance, 'Expected the refunded wallet to carry its own new balance');
        WalletB.Get('W-11B');
        Assert.AreEqual(400.0, WalletB.Balance, 'Expected the other wallet''s balance to be left exactly as it was');
        Assert.AreEqual(100.0, WalletB."Total Charged",
            'Expected the other wallet''s running total to be left exactly as it was');
        Assert.AreEqual(1, X160_EntryCountFor('W-11B'), 'Expected the other wallet''s ledger to carry only its own entry');
    end;

    // ==========================================================
    // X163 - donor CG-AL-X163
    // ==========================================================

    local procedure X163_GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure X163_ClearHomeLedger()
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearOtherLedger(OtherName: Text[30])
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.ChangeCompany(OtherName);
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearQueryLog()
    var
        QueryLog: Record "CG X163 Query Log";
    begin
        QueryLog.DeleteAll();
    end;

    local procedure X163_ClearBoth(OtherName: Text[30])
    begin
        X163_ClearHomeLedger();
        X163_ClearOtherLedger(OtherName);
        X163_ClearQueryLog();
        Commit();
    end;

    [Test]
    procedure X163_TheGroupTotalCombinesEachBranchsOwnAmountForAnAccount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-A', 40.5);
        LedgerMgt.SetAmount(OtherName, 'ACCT-A', 27.25);

        Total := GroupTotals.GetGroupTotal('ACCT-A');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(67.75, Total,
            'Expected the group total for the account to combine every branch''s own configured amount for it');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheOtherBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(OtherName, 'ACCT-B', 18.75);

        Total := GroupTotals.GetGroupTotal('ACCT-B');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(18.75, Total,
            'Expected an account configured only on the other branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheHomeBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-C', 30.0);

        Total := GroupTotals.GetGroupTotal('ACCT-C');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(30.0, Total,
            'Expected an account configured only on the home branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_TheGroupTotalForOneAccountIsNotContaminatedByAnotherAccountInTheSameBranch()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-P', 12.0);
        LedgerMgt.SetAmount(CompanyName(), 'ACCT-Q', 999.0);

        Total := GroupTotals.GetGroupTotal('ACCT-P');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(12.0, Total,
            'Expected the group total for one account to be unaffected by a different account configured in the same branch');
    end;

    [Test]
    procedure X163_AnAccountWithNoConfiguredAmountAnywhereTotalsToZero()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Total := GroupTotals.GetGroupTotal('ACCT-Z');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(0.0, Total,
            'Expected an account with no configured amount on any branch to total to zero');
    end;

    [Test]
    procedure X163_EachBranchsConfiguredAmountIsStoredOnItsOwnRecordUnaffectedByTheOtherBranch()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeLedger: Record "CG X163 Branch Ledger";
        OtherLedger: Record "CG X163 Branch Ledger";
        HomeDirect: Decimal;
        OtherDirect: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        HomeName := CompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(HomeName, 'ACCT-M', 17.0);
        LedgerMgt.SetAmount(OtherName, 'ACCT-M', 9.0);

        HomeDirect := LedgerMgt.GetAmountDirect(HomeName, 'ACCT-M');
        OtherDirect := LedgerMgt.GetAmountDirect(OtherName, 'ACCT-M');

        HomeLedger.Get('ACCT-M');
        OtherLedger.ChangeCompany(OtherName);
        OtherLedger.Get('ACCT-M');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(17.0, HomeDirect,
            'Expected the home branch''s configured amount to be unaffected by the other branch''s configured amount for the same account');
        Assert.AreEqual(9.0, OtherDirect,
            'Expected the other branch''s configured amount to reflect what it configured for itself');
        Assert.AreEqual(17.0, HomeLedger.Amount,
            'Expected the home branch''s amount to be persisted with its own value on its own record');
        Assert.AreEqual(9.0, OtherLedger.Amount,
            'Expected the other branch''s amount to be persisted with its own value on its own record');
    end;

    [Test]
    procedure X163_ABranchWithNoConfiguredAmountForAGivenAccountIsTreatedAsZero()
    var
        OtherName: Text[30];
        Direct: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Direct := LedgerMgt.GetAmountDirect(CompanyName(), 'ACCT-N');

        Assert.AreEqual(0.0, Direct,
            'Expected no configured amount for an account on a branch to read as zero rather than an arbitrary leftover value');
    end;
}
