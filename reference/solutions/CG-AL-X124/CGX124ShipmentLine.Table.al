table 70841 "CG X124 Shipment Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Shipment No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Item Code"; Code[20]) { DataClassification = CustomerContent; }
        field(4; Weight; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Shipment No.", "Line No.") { Clustered = true; }
    }
}
