codeunit 70311 "CGR Lease Invoicing"
{
    procedure InvoiceDueLines(ContractNo: Code[20]; UpToDate: Date): Integer
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Invoiced: Integer;
    begin
        Contract.Get(ContractNo);
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetRange("Due Date", 0D, UpToDate);
        if ScheduleLine.FindSet() then
            repeat
                CreateInvoiceLine(Contract, ScheduleLine);
                LeaseMgt.InvoiceLine(ContractNo, ScheduleLine."Line No.");
                Invoiced += 1;
            until ScheduleLine.Next() = 0;
        exit(Invoiced);
    end;

    procedure TransferToGeneralJournal(ContractNo: Code[20]; TemplateName: Code[10]; BatchName: Code[10]; AccountNo: Code[20]): Integer
    var
        Contract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        GenJnlLine: Record "Gen. Journal Line";
        LastGenJnlLine: Record "Gen. Journal Line";
        NextLineNo: Integer;
        Created: Integer;
    begin
        Contract.Get(ContractNo);
        LastGenJnlLine.SetRange("Journal Template Name", TemplateName);
        LastGenJnlLine.SetRange("Journal Batch Name", BatchName);
        if LastGenJnlLine.FindLast() then
            NextLineNo := LastGenJnlLine."Line No.";
        InvoiceLine.SetRange("Contract No.", ContractNo);
        if InvoiceLine.FindSet() then
            repeat
                NextLineNo += 10000;
                GenJnlLine.Init();
                GenJnlLine."Journal Template Name" := TemplateName;
                GenJnlLine."Journal Batch Name" := BatchName;
                GenJnlLine."Line No." := NextLineNo;
                GenJnlLine.Insert();
                GenJnlLine.Validate("Posting Date", InvoiceLine."Invoice Date");
                GenJnlLine."Document No." := Contract."No.";
                GenJnlLine.Validate("Account Type", GenJnlLine."Account Type"::"G/L Account");
                GenJnlLine.Validate("Account No.", AccountNo);
                GenJnlLine.Validate(Amount, InvoiceLine.Amount);
                GenJnlLine."Dimension Set ID" := Contract."Dimension Set ID";
                if Contract."Job No." <> '' then
                    GenJnlLine.Validate("Job No.", Contract."Job No.");
                GenJnlLine.Modify();
                Created += 1;
            until InvoiceLine.Next() = 0;
        exit(Created);
    end;

    procedure InvoiceDate(DueDate: Date): Date
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        if WorkingDays.IsWorkingDay(DueDate) then
            exit(DueDate);
        exit(WorkingDays.NextWorkingDay(DueDate));
    end;

    local procedure CreateInvoiceLine(Contract: Record "CGR Lease Contract"; ScheduleLine: Record "CGR Lease Schedule Line")
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        AmountRounding: Codeunit "CGR Amount Rounding";
        IsHandled: Boolean;
    begin
        InvoiceLine.Init();
        InvoiceLine."Contract No." := Contract."No.";
        InvoiceLine."Schedule Line No." := ScheduleLine."Line No.";
        InvoiceLine."Vehicle No." := Contract."Vehicle No.";
        InvoiceLine."Customer Name" := Contract."Customer Name";
        InvoiceLine."Due Date" := ScheduleLine."Due Date";
        InvoiceLine."Invoice Date" := InvoiceDate(ScheduleLine."Due Date");
        InvoiceLine.Amount := AmountRounding.RoundAmount(ScheduleLine.Amount);
        OnBeforeCreateInvoiceLine(ScheduleLine, InvoiceLine, IsHandled);
        if IsHandled then
            exit;
        InvoiceLine.Insert(true);
        OnAfterCreateInvoiceLine(ScheduleLine, InvoiceLine);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line"; var IsHandled: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCreateInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    begin
    end;
}
