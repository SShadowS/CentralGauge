codeunit 70282 "CGR Cancellation Fee"
{
    procedure CalcCancellationFee(Contract: Record "CGR Rental Contract"; CancelDate: Date; Waive: Boolean): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        RentalValue: Decimal;
        DaysBefore: Integer;
    begin
        if Waive then
            exit(0);
        Vehicle.Get(Contract."Vehicle No.");
        RentalValue := Vehicle."Daily Rate" * (Contract."End Date" - Contract."Start Date" + 1);
        DaysBefore := Contract."Start Date" - CancelDate;
        if DaysBefore >= 7 then
            exit(0);
        if DaysBefore >= 3 then
            exit(Round(RentalValue / 2, 0.01));
        exit(Round(RentalValue, 0.01));
    end;
}
