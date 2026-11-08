codeunit 70279"CGR Web Booking Create"
{
    var
        BookedVehicleNo: Code[20];
        BookedCustomer: Text[100];
        BookedStart: Date;
        BookedEnd: Date;

    procedure SetBooking(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; EndDate: Date)
    begin
        BookedVehicleNo := VehicleNo;
        BookedCustomer := CustomerName;
        BookedStart := StartDate;
        BookedEnd := EndDate;
    end;

    trigger OnRun()
    begin
        CreateFromBooking();
    end;

    procedure CreateFromBooking()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Vehicle.Get(BookedVehicleNo);
        ContractNo := RentalMgt.CreateContract(BookedVehicleNo, BookedCustomer, BookedStart, BookedEnd);
        OnAfterImportBooking(ContractNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterImportBooking(ContractNo: Code[20])
    begin
    end;
}
