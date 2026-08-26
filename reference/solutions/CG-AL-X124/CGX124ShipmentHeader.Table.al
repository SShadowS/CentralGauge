table 70840 "CG X124 Shipment Header"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Customer Name"; Text[100]) { DataClassification = CustomerContent; }
        field(3; "Total Weight"; Decimal) { DataClassification = CustomerContent; }
        field(4; "Line Count"; Integer) { DataClassification = CustomerContent; }
        field(5; "Route Code"; Code[10]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
