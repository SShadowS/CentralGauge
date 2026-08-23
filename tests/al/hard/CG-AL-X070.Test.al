codeunit 88823 "CG-AL-X070 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears both tables before seeding its own rows. Each test
    // also uses its own Batch Code so seeding never collides with another
    // test's rows even before the clear runs.

    local procedure Reset()
    var
        ImportLine: Record "CG X070 Import Line";
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        ImportLine.DeleteAll();
        ImportedOrder.DeleteAll();
    end;

    local procedure CreateLine(BatchCode: Code[20]; LineNo: Integer; CustomerNo: Code[20]; LineQuantity: Decimal)
    begin
        CreateLine(BatchCode, LineNo, CustomerNo, LineQuantity, "CG X070 Import Status"::Pending);
    end;

    local procedure CreateLine(BatchCode: Code[20]; LineNo: Integer; CustomerNo: Code[20]; LineQuantity: Decimal; LineStatus: Enum "CG X070 Import Status")
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

    local procedure ImportedOrderCount(BatchCode: Code[20]): Integer
    var
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        ImportedOrder.SetRange("Batch Code", BatchCode);
        exit(ImportedOrder.Count());
    end;

    local procedure ImportedOrderExists(BatchCode: Code[20]; LineNo: Integer): Boolean
    var
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        exit(ImportedOrder.Get(BatchCode, LineNo));
    end;

    local procedure AssertLineHasStatus(BatchCode: Code[20]; LineNo: Integer; ExpectedStatus: Enum "CG X070 Import Status"; Msg: Text)
    var
        ImportLine: Record "CG X070 Import Line";
    begin
        Assert.IsTrue(ImportLine.Get(BatchCode, LineNo), StrSubstNo('Expected line %1 of batch %2 to still exist', LineNo, BatchCode));
        Assert.AreEqual(Format(ExpectedStatus), Format(ImportLine.Status), Msg);
    end;

    local procedure AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the error to mention "%1", got: %2', Fragment, ActualError));
    end;

    [Test]
    procedure AllPendingLinesOfTheBatchAreImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
    begin
        Reset();
        CreateLine('X70-T01', 10, 'CUST-A', Any.DecimalInRange(1, 500, 2));
        CreateLine('X70-T01', 20, 'CUST-B', Any.DecimalInRange(1, 500, 2));
        CreateLine('X70-T01', 30, 'CUST-C', Any.DecimalInRange(1, 500, 2));

        ImportBatch.ImportBatch('X70-T01');

        Assert.AreEqual(3, ImportedOrderCount('X70-T01'), 'Expected exactly one imported order per pending line of a clean batch');
        AssertLineHasStatus('X70-T01', 10, "CG X070 Import Status"::Imported, 'Line 10 must be marked imported');
        AssertLineHasStatus('X70-T01', 20, "CG X070 Import Status"::Imported, 'Line 20 must be marked imported');
        AssertLineHasStatus('X70-T01', 30, "CG X070 Import Status"::Imported, 'Line 30 must be marked imported');
    end;

    [Test]
    procedure ImportCopiesCustomerAndQuantityToTheImportedOrder()
    var
        ImportedOrder: Record "CG X070 Imported Order";
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
        CustomerNo: Code[20];
        LineQuantity: Decimal;
    begin
        Reset();
        CustomerNo := CopyStr('X70-' + UpperCase(Any.AlphabeticText(10)), 1, 20);
        LineQuantity := Any.DecimalInRange(1, 900, 2);
        CreateLine('X70-T02', 10, CustomerNo, LineQuantity);

        ImportBatch.ImportBatch('X70-T02');

        Assert.IsTrue(ImportedOrder.Get('X70-T02', 10), 'Expected an imported order for the imported line');
        Assert.AreEqual(CustomerNo, ImportedOrder."Customer No.", 'Expected the line''s customer to carry over to the imported order');
        Assert.AreEqual(LineQuantity, ImportedOrder.Quantity, 'Expected the line''s quantity to carry over to the imported order');
    end;

    [Test]
    procedure ALineWithNoCustomerFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        CreateLine('X70-T03', 10, '', 5);
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T03');

        AssertErrorContains('Customer No.');
        AssertErrorContains('must have a value');
        Assert.IsFalse(ImportedOrderExists('X70-T03', 10), 'Expected no imported order for a line missing its customer');
        AssertLineHasStatus('X70-T03', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    [Test]
    procedure AZeroQuantityLineFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        CreateLine('X70-T04', 10, 'CUST-A', 0);
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T04');

        AssertErrorContains('must be positive');
        Assert.IsFalse(ImportedOrderExists('X70-T04', 10), 'Expected no imported order for a zero-quantity line');
        AssertLineHasStatus('X70-T04', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    [Test]
    procedure ANegativeQuantityLineFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
    begin
        Reset();
        CreateLine('X70-T05', 10, 'CUST-A', -Any.DecimalInRange(1, 500, 2));
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T05');

        AssertErrorContains('must be positive');
        Assert.IsFalse(ImportedOrderExists('X70-T05', 10), 'Expected no imported order for a negative-quantity line');
        AssertLineHasStatus('X70-T05', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    local procedure SeedPoisonedBatch(BatchCode: Code[20])
    var
        Any: Codeunit Any;
    begin
        CreateLine(BatchCode, 10, 'CUST-A', Any.DecimalInRange(1, 500, 2));
        CreateLine(BatchCode, 20, 'CUST-B', Any.DecimalInRange(1, 500, 2));
        CreateLine(BatchCode, 30, '', Any.DecimalInRange(1, 500, 2));
        CreateLine(BatchCode, 40, 'CUST-D', Any.DecimalInRange(1, 500, 2));
        // Committed so the failing run's own error can only affect what the
        // run itself writes, never this test's own arrangement.
        Commit();
    end;

    [Test]
    procedure LinesImportedBeforeAFailingLineSurviveTheRun()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        SeedPoisonedBatch('X70-T06');

        asserterror ImportBatch.ImportBatch('X70-T06');

        AssertErrorContains('must have a value');
        Assert.IsTrue(ImportedOrderExists('X70-T06', 10),
            'Expected the imported order of line 10 to still exist after a later line in the same run failed');
        Assert.IsTrue(ImportedOrderExists('X70-T06', 20),
            'Expected the imported order of line 20 to still exist after a later line in the same run failed');
        AssertLineHasStatus('X70-T06', 10, "CG X070 Import Status"::Imported, 'Line 10 must remain marked imported after a later line failed');
        AssertLineHasStatus('X70-T06', 20, "CG X070 Import Status"::Imported, 'Line 20 must remain marked imported after a later line failed');
    end;

    [Test]
    procedure TheFailingLineAndItsSuccessorAreNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        SeedPoisonedBatch('X70-T07');

        asserterror ImportBatch.ImportBatch('X70-T07');

        AssertErrorContains('must have a value');
        Assert.IsFalse(ImportedOrderExists('X70-T07', 30), 'Expected no imported order for the line that failed its own guard');
        AssertLineHasStatus('X70-T07', 30, "CG X070 Import Status"::Pending, 'The failing line itself must stay pending');
        Assert.IsFalse(ImportedOrderExists('X70-T07', 40), 'Expected no imported order for the line after the one that failed - the run must stop there');
        AssertLineHasStatus('X70-T07', 40, "CG X070 Import Status"::Pending, 'The line after the failing one must stay untouched');
    end;

    [Test]
    procedure RepairedBatchResumesWithoutDuplicatingEarlierLines()
    var
        ImportLine: Record "CG X070 Import Line";
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        SeedPoisonedBatch('X70-T08');
        asserterror ImportBatch.ImportBatch('X70-T08');
        ImportLine.Get('X70-T08', 30);
        ImportLine."Customer No." := 'CUST-FIX';
        ImportLine.Modify();
        Commit();

        ImportBatch.ImportBatch('X70-T08');

        Assert.AreEqual(4, ImportedOrderCount('X70-T08'),
            'Expected the repaired rerun to leave exactly one imported order per line - no duplicates for lines imported on the earlier run');
        AssertLineHasStatus('X70-T08', 10, "CG X070 Import Status"::Imported, 'Line 10 must be imported');
        AssertLineHasStatus('X70-T08', 20, "CG X070 Import Status"::Imported, 'Line 20 must be imported');
        AssertLineHasStatus('X70-T08', 30, "CG X070 Import Status"::Imported, 'The repaired line must be imported');
        AssertLineHasStatus('X70-T08', 40, "CG X070 Import Status"::Imported, 'The line after the repaired one must be imported');
    end;

    [Test]
    procedure ImportOnlyAffectsLinesOfTheGivenBatch()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        CreateLine('X70-T09A', 10, 'CUST-A', 10);
        CreateLine('X70-T09A', 20, 'CUST-B', 20);
        CreateLine('X70-T09B', 10, '', 5);

        ImportBatch.ImportBatch('X70-T09A');

        Assert.AreEqual(2, ImportedOrderCount('X70-T09A'), 'Expected both lines of the given batch to be imported');
        Assert.AreEqual(0, ImportedOrderCount('X70-T09B'), 'Expected a neighbour batch to be left untouched by importing a different batch');
        AssertLineHasStatus('X70-T09B', 10, "CG X070 Import Status"::Pending, 'A neighbour batch''s line must stay pending');
    end;

    [Test]
    procedure AlreadyImportedLinesAreNotReprocessed()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        CreateLine('X70-T10', 10, 'CUST-A', 5, "CG X070 Import Status"::Imported);
        CreateLine('X70-T10', 20, 'CUST-B', 7);

        ImportBatch.ImportBatch('X70-T10');

        Assert.IsFalse(ImportedOrderExists('X70-T10', 10), 'Expected no new imported order for a line already marked imported');
        Assert.IsTrue(ImportedOrderExists('X70-T10', 20), 'Expected the pending line to be imported');
    end;

    [Test]
    procedure EmptyBatchIsAQuietNoOp()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();

        ImportBatch.ImportBatch('X70-T11');

        Assert.AreEqual(0, ImportedOrderCount('X70-T11'), 'Expected a batch with no pending lines to import nothing');
    end;

    [Test]
    procedure ALineThatFailsToWriteStillSparesItsPredecessors()
    var
        ImportedOrder: Record "CG X070 Imported Order";
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        Reset();
        CreateLine('X70-T12', 10, 'CUST-A', 10);
        CreateLine('X70-T12', 20, 'CUST-B', 20);
        CreateLine('X70-T12', 30, 'CUST-C', 30);
        CreateLine('X70-T12', 40, 'CUST-D', 40);
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

        AssertErrorContains('already exists');
        Assert.IsTrue(ImportedOrderExists('X70-T12', 10),
            'Expected the imported order of line 10 to still exist after a later line crashed while writing its own imported order');
        Assert.IsTrue(ImportedOrderExists('X70-T12', 20),
            'Expected the imported order of line 20 to still exist after a later line crashed while writing its own imported order');
        AssertLineHasStatus('X70-T12', 10, "CG X070 Import Status"::Imported, 'Line 10 must remain marked imported');
        AssertLineHasStatus('X70-T12', 20, "CG X070 Import Status"::Imported, 'Line 20 must remain marked imported');
        AssertLineHasStatus('X70-T12', 30, "CG X070 Import Status"::Pending, 'The line that crashed while writing must stay pending');
        Assert.IsFalse(ImportedOrderExists('X70-T12', 40), 'Expected no imported order for the line after the one that crashed - the run must stop there');
    end;
}
