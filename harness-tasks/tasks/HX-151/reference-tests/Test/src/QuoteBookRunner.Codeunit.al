codeunit 80583 "CGR Quote Book Runner"
{
    var
        RunVehicleNo: Code[20];
        RunStartDate: Date;
        RunEndDate: Date;
        RunCustomerName: Text[100];
        RunContractNo: Code[20];

    trigger OnRun()
    var
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        RunContractNo := QuoteMgt.BookQuote(RunVehicleNo, RunStartDate, RunEndDate, RunCustomerName);
    end;

    procedure SetQuoteToBook(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; CustomerName: Text[100])
    begin
        RunVehicleNo := VehicleNo;
        RunStartDate := StartDate;
        RunEndDate := EndDate;
        RunCustomerName := CustomerName;
        RunContractNo := '';
    end;

    procedure BookedContractNo(): Code[20]
    begin
        exit(RunContractNo);
    end;
}
