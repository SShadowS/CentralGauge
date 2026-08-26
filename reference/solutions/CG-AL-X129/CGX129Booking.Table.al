table 70891 "CG X129 Booking"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Tier Code"; Code[20]) { DataClassification = CustomerContent; }
        field(3; Hours; Decimal) { DataClassification = CustomerContent; }
        field(4; Amount; Decimal) { DataClassification = CustomerContent; }
        field(5; "Customer Name"; Text[100]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
        key(ByTier; "Tier Code") { }
    }
}
