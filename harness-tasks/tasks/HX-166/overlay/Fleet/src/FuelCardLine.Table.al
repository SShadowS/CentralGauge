table 70184 "CGR Fuel Card Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry Code"; Code[20]) { }
        field(2; "Vehicle No."; Code[20]) { }
        field(3; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Entry Code") { Clustered = true; }
    }
}
