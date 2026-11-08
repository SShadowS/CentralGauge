codeunit 88017 "HX137 Booking Runner"
{
    var
        MarkerNo: Code[20];
        BookingErr: Label 'HX137 booking failed after the contract was created.', Locked = true;

    procedure SetHX137Marker(NewMarkerNo: Code[20])
    begin
        MarkerNo := NewMarkerNo;
    end;

    trigger OnRun()
    var
        Marker: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Marker.Init();
        Marker."No." := MarkerNo;
        Marker."Customer Name" := 'HX137 booking marker';
        Marker.Insert();
        RentalMgt.CreateContract('HX137-VB', 'HX137 Booking', 20260112D, 20260114D);
        Error(BookingErr);
    end;
}
