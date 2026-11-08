table 87866 "HX127 Partner Order"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Order No."; Code[20]) { }
        field(2; Description; Text[50]) { }
        field(4; "Region Code"; Code[10]) { }
        field(7; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Order No.") { Clustered = true; }
    }
}
