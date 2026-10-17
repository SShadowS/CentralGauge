codeunit 86921 "HX073 Due Lines Runner"
{
    var
        RunAction: Option InvoiceLines,DueLines;
        ContractNo: Code[20];
        UpToDate: Date;
        LineCount: Integer;

    procedure HX73SetInvoice(NewContractNo: Code[20]; NewUpToDate: Date)
    begin
        ContractNo := NewContractNo;
        UpToDate := NewUpToDate;
        RunAction := RunAction::InvoiceLines;
    end;

    procedure HX73SetDueLines(NewContractNo: Code[20]; NewUpToDate: Date)
    begin
        ContractNo := NewContractNo;
        UpToDate := NewUpToDate;
        RunAction := RunAction::DueLines;
    end;

    procedure HX73LineCount(): Integer
    begin
        exit(LineCount);
    end;

    trigger OnRun()
    var
        TempDueLine: Record "CGR Lease Schedule Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        LineCount := -1;
        case RunAction of
            RunAction::InvoiceLines:
                LineCount := LeaseInvoicing.InvoiceDueLines(ContractNo, UpToDate);
            RunAction::DueLines:
                LineCount := LeaseInvoicing.GetDueLines(ContractNo, UpToDate, TempDueLine);
        end;
    end;
}
