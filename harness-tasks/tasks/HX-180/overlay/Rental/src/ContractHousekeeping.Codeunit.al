codeunit 70235 "CGR Contract Housekeeping"
{
    var
        BookingNotOpenErr: Label 'Rental contract %1 is not an open booking.', Comment = '%1 = contract number';

    procedure CancelBooking(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Open then
            Error(BookingNotOpenErr, ContractNo);
        Contract.Delete(true);
        OnAfterBookingCancelled(Contract);
    end;

    procedure PurgePostedContracts(): Integer
    var
        Contract: Record "CGR Rental Contract";
        Purged: Integer;
    begin
        Contract.SetRange(Status, Contract.Status::Posted);
        Contract.SetFilter("End Date", '<%1', CalcDate('<-1Y>', WorkDate()));
        Purged := Contract.Count();
        Contract.DeleteAll(false);
        exit(Purged);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterBookingCancelled(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
