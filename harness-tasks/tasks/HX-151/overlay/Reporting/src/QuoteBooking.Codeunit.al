codeunit 70582 "CGR Quote Booking"
{
    var
        BookVehicleNo: Code[20];
        BookStartDate: Date;
        BookEndDate: Date;
        BookCustomerName: Text[100];
        BookPrice: Decimal;
        BookedContractNo: Code[20];

    trigger OnRun()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        BookedContractNo := RentalMgt.CreateContract(BookVehicleNo, BookCustomerName, BookStartDate, BookEndDate);
        Contract.Get(BookedContractNo);
        Contract."Agreed Price" := BookPrice;
        Contract.Modify();
        OnAfterBookQuote(Contract);
    end;

    procedure SetQuote(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; CustomerName: Text[100]; Price: Decimal)
    begin
        BookVehicleNo := VehicleNo;
        BookStartDate := StartDate;
        BookEndDate := EndDate;
        BookCustomerName := CustomerName;
        BookPrice := Price;
        BookedContractNo := '';
    end;

    procedure BookedQuoteContractNo(): Code[20]
    begin
        exit(BookedContractNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterBookQuote(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
