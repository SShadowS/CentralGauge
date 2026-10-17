codeunit 86962 "HX075 Invoice Runner"
{
    var
        RunAction: Option InvoiceLease,NumberThenFail;
        LeaseNo: Code[20];
        UpToDate: Date;
        LaterStepErr: Label 'HX075 later step failed.', Locked = true;

    procedure HX75SetInvoice(NewLeaseNo: Code[20]; NewUpToDate: Date)
    begin
        LeaseNo := NewLeaseNo;
        UpToDate := NewUpToDate;
        RunAction := RunAction::InvoiceLease;
    end;

    procedure HX75SetNumberThenFail()
    begin
        RunAction := RunAction::NumberThenFail;
    end;

    trigger OnRun()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        case RunAction of
            RunAction::InvoiceLease:
                LeaseInvoicing.InvoiceDueLines(LeaseNo, UpToDate);
            RunAction::NumberThenFail:
                begin
                    LeaseInvoicing.NextLeaseInvoiceNo();
                    Error(LaterStepErr);
                end;
        end;
    end;
}
