codeunit 88630 "HX178 Lease Journal Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        TemplateTok: Label 'HX178', Locked = true;
        BatchTok: Label 'LEASE', Locked = true;
        AreaTok: Label 'HX178AREA', Locked = true;
        DeptTok: Label 'HX178DEPT', Locked = true;
        JobTok: Label 'HX178-JOB', Locked = true;
        LeaseDimsTxt: Label 'HX178AREA=NORTH HX178DEPT=SALES ', Locked = true;

    [Test]
    procedure LeaseWithoutJobLinesCarryLeaseDimensions()
    var
        GenJnlLine: Record "Gen. Journal Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRunHX178();
        NewLeaseHX178('HX178-A', LeaseDimSetHX178(), '');

        LeaseInvoicing.TransferToGeneralJournal('HX178-A', TemplateTok, BatchTok, BalanceAccountHX178());

        FilterBatchHX178(GenJnlLine);
        Assert.AreEqual(2, GenJnlLine.Count(), 'One journal line per invoice line of the lease');
        GenJnlLine.FindSet();
        repeat
            Assert.AreEqual(LeaseDimsTxt, DimTextHX178(GenJnlLine."Dimension Set ID"), 'A line of a lease without a job carries the lease''s dimensions');
            Assert.AreEqual('', GenJnlLine."Job No.", 'A line of a lease without a job is not booked to a job');
        until GenJnlLine.Next() = 0;
    end;

    [Test]
    procedure LinesFollowInvoiceLines()
    var
        GenJnlLine: Record "Gen. Journal Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        AccountNo: Code[20];
        Created: Integer;
    begin
        InitRunHX178();
        NewLeaseHX178('HX178-A', LeaseDimSetHX178(), '');
        NewLeaseHX178('HX178-B', LeaseDimSetHX178(), '');
        AccountNo := BalanceAccountHX178();

        Created := LeaseInvoicing.TransferToGeneralJournal('HX178-A', TemplateTok, BatchTok, AccountNo);

        Assert.AreEqual(2, Created, 'The procedure returns the number of journal lines it created');
        FilterBatchHX178(GenJnlLine);
        Assert.AreEqual(2, GenJnlLine.Count(), 'Only the invoice lines of the given lease are transferred');
        AssertLineHX178(20250203D, 410.25, AccountNo);
        AssertLineHX178(20250303D, 410.30, AccountNo);
    end;

    [Test]
    procedure JobLeaseLinesAreBookedToTheJob()
    var
        GenJnlLine: Record "Gen. Journal Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRunHX178();
        NewLeaseHX178('HX178-J', LeaseDimSetHX178(), NewJobHX178());

        LeaseInvoicing.TransferToGeneralJournal('HX178-J', TemplateTok, BatchTok, BalanceAccountHX178());

        FilterBatchHX178(GenJnlLine);
        Assert.AreEqual(2, GenJnlLine.Count(), 'One journal line per invoice line of the lease');
        GenJnlLine.FindSet();
        repeat
            Assert.AreEqual(JobTok, GenJnlLine."Job No.", 'A line of a lease booked to a job is booked to that job');
        until GenJnlLine.Next() = 0;
    end;

    [Test]
    procedure JobLeaseLinesKeepEveryLeaseDimension()
    var
        GenJnlLine: Record "Gen. Journal Line";
        DimSetEntry: Record "Dimension Set Entry";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRunHX178();
        NewLeaseHX178('HX178-J', LeaseDimSetHX178(), NewJobHX178());

        LeaseInvoicing.TransferToGeneralJournal('HX178-J', TemplateTok, BatchTok, BalanceAccountHX178());

        FilterBatchHX178(GenJnlLine);
        Assert.AreEqual(2, GenJnlLine.Count(), 'One journal line per invoice line of the lease');
        GenJnlLine.FindSet();
        repeat
            Assert.IsTrue(DimSetEntry.Get(GenJnlLine."Dimension Set ID", AreaTok), 'A line of a lease booked to a job keeps the lease''s area dimension; line has ' + DimTextHX178(GenJnlLine."Dimension Set ID"));
            Assert.AreEqual('NORTH', DimSetEntry."Dimension Value Code", 'The area dimension keeps the lease''s value');
        until GenJnlLine.Next() = 0;
    end;

    [Test]
    procedure JobLeaseLinesKeepLeaseValues()
    var
        GenJnlLine: Record "Gen. Journal Line";
        DimSetEntry: Record "Dimension Set Entry";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRunHX178();
        NewLeaseHX178('HX178-J', LeaseDimSetHX178(), NewJobHX178());

        LeaseInvoicing.TransferToGeneralJournal('HX178-J', TemplateTok, BatchTok, BalanceAccountHX178());

        FilterBatchHX178(GenJnlLine);
        Assert.AreEqual(2, GenJnlLine.Count(), 'One journal line per invoice line of the lease');
        GenJnlLine.FindSet();
        repeat
            DimSetEntry.SetRange("Dimension Set ID", GenJnlLine."Dimension Set ID");
            DimSetEntry.SetRange("Dimension Code", DeptTok);
            Assert.AreEqual('SALES', ValueOrBlankHX178(DimSetEntry), 'The department on a line of a lease booked to a job is the lease''s department');
            Assert.AreEqual(LeaseDimsTxt, DimTextHX178(GenJnlLine."Dimension Set ID"), 'A line of a lease booked to a job carries exactly the lease''s dimensions');
        until GenJnlLine.Next() = 0;
    end;

    local procedure InitRunHX178()
    var
        Template: Record "Gen. Journal Template";
        Batch: Record "Gen. Journal Batch";
        GenJnlLine: Record "Gen. Journal Line";
        Values: List of [Code[20]];
    begin
        WorkDate(20250115D);
        if not Template.Get(TemplateTok) then begin
            Template.Init();
            Template.Name := TemplateTok;
            Template.Type := Template.Type::General;
            Template.Insert();
        end;
        if not Batch.Get(TemplateTok, BatchTok) then begin
            Batch.Init();
            Batch."Journal Template Name" := TemplateTok;
            Batch.Name := BatchTok;
            Batch.Insert();
        end;
        FilterBatchHX178(GenJnlLine);
        GenJnlLine.DeleteAll();
        Values.Add('SALES');
        Values.Add('PROJECTS');
        NewDimensionHX178(DeptTok, Values);
        Clear(Values);
        Values.Add('NORTH');
        NewDimensionHX178(AreaTok, Values);
    end;

    local procedure NewDimensionHX178(DimCode: Code[20]; Values: List of [Code[20]])
    var
        Dim: Record Dimension;
        DimValue: Record "Dimension Value";
        V: Code[20];
    begin
        if not Dim.Get(DimCode) then begin
            Dim.Init();
            Dim.Code := DimCode;
            Dim.Insert();
        end;
        foreach V in Values do
            if not DimValue.Get(DimCode, V) then begin
                DimValue.Init();
                DimValue."Dimension Code" := DimCode;
                DimValue.Code := V;
                DimValue.Insert();
            end;
    end;

    local procedure LeaseDimSetHX178(): Integer
    var
        TempDimSetEntry: Record "Dimension Set Entry" temporary;
        DimMgt: Codeunit DimensionManagement;
    begin
        TempDimSetEntry.Init();
        TempDimSetEntry."Dimension Code" := DeptTok;
        TempDimSetEntry.Validate("Dimension Value Code", 'SALES');
        TempDimSetEntry.Insert();
        TempDimSetEntry.Init();
        TempDimSetEntry."Dimension Code" := AreaTok;
        TempDimSetEntry.Validate("Dimension Value Code", 'NORTH');
        TempDimSetEntry.Insert();
        exit(DimMgt.GetDimensionSetID(TempDimSetEntry));
    end;

    local procedure NewJobHX178(): Code[20]
    var
        Job: Record Job;
        DefaultDim: Record "Default Dimension";
    begin
        if Job.Get(JobTok) then
            Job.Delete();
        Job.Init();
        Job."No." := JobTok;
        Job.Insert();
        Job.Status := Job.Status::Open;
        Job.Modify();
        if DefaultDim.Get(Database::Job, JobTok, DeptTok) then
            DefaultDim.Delete();
        DefaultDim.Init();
        DefaultDim."Table ID" := Database::Job;
        DefaultDim."No." := JobTok;
        DefaultDim."Dimension Code" := DeptTok;
        DefaultDim."Dimension Value Code" := 'PROJECTS';
        DefaultDim.Insert();
        exit(JobTok);
    end;

    local procedure NewLeaseHX178(LeaseNo: Code[20]; DimSetID: Integer; JobNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        if Contract.Get(LeaseNo) then
            Contract.Delete();
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := 'HX178-V';
        Contract."Customer Name" := 'HX178 Site Works';
        Contract."Start Date" := 20250201D;
        Contract.Months := 2;
        Contract."Base Rate" := 400;
        Contract."Dimension Set ID" := DimSetID;
        Contract."Job No." := JobNo;
        Contract.Insert();
        NewInvoiceLineHX178(LeaseNo, 10000, 20250201D, 20250203D, 410.25);
        NewInvoiceLineHX178(LeaseNo, 20000, 20250301D, 20250303D, 410.30);
    end;

    local procedure NewInvoiceLineHX178(LeaseNo: Code[20]; LineNo: Integer; DueDate: Date; InvoiceDate: Date; Amount: Decimal)
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        InvoiceLine.Init();
        InvoiceLine."Contract No." := LeaseNo;
        InvoiceLine."Schedule Line No." := LineNo;
        InvoiceLine."Vehicle No." := 'HX178-V';
        InvoiceLine."Customer Name" := 'HX178 Site Works';
        InvoiceLine."Due Date" := DueDate;
        InvoiceLine."Invoice Date" := InvoiceDate;
        InvoiceLine.Amount := Amount;
        InvoiceLine.Insert();
    end;

    local procedure BalanceAccountHX178(): Code[20]
    var
        GLAcc: Record "G/L Account";
    begin
        GLAcc.SetRange("Account Type", GLAcc."Account Type"::Posting);
        GLAcc.SetRange("Direct Posting", true);
        GLAcc.SetRange(Blocked, false);
        GLAcc.SetRange("Income/Balance", GLAcc."Income/Balance"::"Balance Sheet");
        GLAcc.SetRange("Gen. Posting Type", GLAcc."Gen. Posting Type"::" ");
        GLAcc.FindFirst();
        exit(GLAcc."No.");
    end;

    local procedure FilterBatchHX178(var GenJnlLine: Record "Gen. Journal Line")
    begin
        GenJnlLine.SetRange("Journal Template Name", TemplateTok);
        GenJnlLine.SetRange("Journal Batch Name", BatchTok);
    end;

    local procedure AssertLineHX178(PostingDate: Date; Amount: Decimal; AccountNo: Code[20])
    var
        GenJnlLine: Record "Gen. Journal Line";
    begin
        FilterBatchHX178(GenJnlLine);
        GenJnlLine.SetRange("Posting Date", PostingDate);
        Assert.AreEqual(1, GenJnlLine.Count(), StrSubstNo('One journal line dated on the invoice date %1', PostingDate));
        GenJnlLine.FindFirst();
        Assert.AreEqual(Amount, GenJnlLine.Amount, 'The line has the invoice line''s amount');
        Assert.AreEqual(GenJnlLine."Account Type"::"G/L Account", GenJnlLine."Account Type", 'The line is a G/L account line');
        Assert.AreEqual(AccountNo, GenJnlLine."Account No.", 'The line is for the given account');
        Assert.AreEqual('HX178-A', GenJnlLine."Document No.", 'The lease number is the document number');
    end;

    local procedure ValueOrBlankHX178(var DimSetEntry: Record "Dimension Set Entry"): Code[20]
    begin
        if DimSetEntry.FindFirst() then
            exit(DimSetEntry."Dimension Value Code");
        exit('');
    end;

    local procedure DimTextHX178(SetId: Integer): Text
    var
        DimSetEntry: Record "Dimension Set Entry";
        T: Text;
    begin
        DimSetEntry.SetRange("Dimension Set ID", SetId);
        DimSetEntry.SetFilter("Dimension Code", '%1|%2', AreaTok, DeptTok);
        if DimSetEntry.FindSet() then
            repeat
                T += DimSetEntry."Dimension Code" + '=' + DimSetEntry."Dimension Value Code" + ' ';
            until DimSetEntry.Next() = 0;
        exit(T);
    end;
}
