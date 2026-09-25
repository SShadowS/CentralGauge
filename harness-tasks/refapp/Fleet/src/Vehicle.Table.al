table 70100 "CGR Vehicle"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Mileage; Integer) { }
        field(3; "Checked Out"; Boolean) { }
        field(4; Strategy; Enum "CGR Maintenance Strategy") { }
        field(5; Blocked; Boolean) { }
        field(6; "Last Service Km"; Integer) { }
        field(7; "Daily Rate"; Decimal) { }
        field(8; Description; Text[100]) { }
        field(9; "Open Damages"; Integer) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
