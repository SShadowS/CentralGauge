codeunit 88600 "HX176 Return Summary Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure BufferSummaryIgnoresStoredCharges()
    var
        TempBuffer: Record "CGR Lease Return Charge" temporary;
        Proposal: Codeunit "CGR Lease Return Proposal";
        LineCount: Integer;
        Total: Decimal;
    begin
        StartHX176();
        StoreChargesHX176();
        AddBufferLineHX176(TempBuffer, 'HX176-A', 10000, 120, true);
        AddBufferLineHX176(TempBuffer, 'HX176-A', 20000, 45.5, true);
        AddBufferLineHX176(TempBuffer, 'HX176-A', 30000, 300, true);

        Total := Proposal.SummarizeReturnCharges(TempBuffer, LineCount);

        Assert.AreEqual(3, LineCount, 'The summary counts the three lines of the buffer, not the stored charges');
        Assert.AreEqual(465.5, Total, 'The summary totals the buffer lines only: 120 + 45.50 + 300');
    end;

    [Test]
    procedure ProposalSummaryIgnoresStoredCharges()
    var
        TempCharge: Record "CGR Lease Return Charge" temporary;
        Proposal: Codeunit "CGR Lease Return Proposal";
        LineCount: Integer;
        Total: Decimal;
    begin
        StartHX176();
        NewLeaseHX176('HX176-L1');
        StoreChargesHX176();

        Total := Proposal.BuildReturnProposal('HX176-L1', 200, 0.4, 350, TempCharge, LineCount);

        Assert.AreEqual(3, LineCount, 'Excess km, damage and return inspection, as today');
        Assert.AreEqual(430, Total, '80 excess km + 350 damage; the inspection is not billed, as today');
        TempCharge.Reset();
        Assert.AreEqual(3, TempCharge.Count(), 'The proposal holds its three lines');
    end;

    [Test]
    procedure NotBilledLineAddsNothingToTheTotal()
    var
        TempBuffer: Record "CGR Lease Return Charge" temporary;
        Proposal: Codeunit "CGR Lease Return Proposal";
        LineCount: Integer;
        Total: Decimal;
    begin
        StartHX176();
        StoreChargesHX176();
        AddBufferLineHX176(TempBuffer, 'HX176-B', 10000, 200, true);
        AddBufferLineHX176(TempBuffer, 'HX176-B', 20000, 75, false);

        Total := Proposal.SummarizeReturnCharges(TempBuffer, LineCount);

        Assert.AreEqual(2, LineCount, 'A line not billed to the customer still counts as a line');
        Assert.AreEqual(200, Total, 'A line not billed to the customer adds nothing to the total');
    end;

    [Test]
    procedure EmptyBufferSummarizesToZero()
    var
        TempBuffer: Record "CGR Lease Return Charge" temporary;
        Proposal: Codeunit "CGR Lease Return Proposal";
        LineCount: Integer;
        Total: Decimal;
    begin
        StartHX176();
        LineCount := 99;

        Total := Proposal.SummarizeReturnCharges(TempBuffer, LineCount);

        Assert.AreEqual(0, LineCount, 'An empty buffer has no lines');
        Assert.AreEqual(0, Total, 'An empty buffer totals 0');
    end;

    local procedure StartHX176()
    var
        Charge: Record "CGR Lease Return Charge";
    begin
        WorkDate(20250115D);
        Charge.DeleteAll();
    end;

    local procedure StoreChargesHX176()
    begin
        StoreChargeHX176('HX176-L1', 10000, 999);
        StoreChargeHX176('HX176-S2', 10000, 50);
    end;

    local procedure StoreChargeHX176(ContractNo: Code[20]; LineNo: Integer; Amount: Decimal)
    var
        Charge: Record "CGR Lease Return Charge";
    begin
        Charge.Init();
        Charge."Contract No." := ContractNo;
        Charge."Line No." := LineNo;
        Charge.Description := 'Accepted earlier';
        Charge.Amount := Amount;
        Charge."Bill Customer" := true;
        Charge.Insert();
    end;

    local procedure AddBufferLineHX176(var TempBuffer: Record "CGR Lease Return Charge" temporary; ContractNo: Code[20]; LineNo: Integer; Amount: Decimal; BillCustomer: Boolean)
    begin
        TempBuffer.Init();
        TempBuffer."Contract No." := ContractNo;
        TempBuffer."Line No." := LineNo;
        TempBuffer.Description := 'Proposed';
        TempBuffer.Amount := Amount;
        TempBuffer."Bill Customer" := BillCustomer;
        TempBuffer.Insert();
    end;

    local procedure NewLeaseHX176(ContractNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := 'HX176-V1';
        Contract."Customer Name" := 'Fjordline Logistics';
        Contract."Start Date" := 20220101D;
        Contract.Months := 36;
        Contract."Base Rate" := 400;
        Contract.Insert();
    end;
}
