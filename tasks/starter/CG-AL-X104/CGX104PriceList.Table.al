table 70640 "CG X104 Price List"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; Description; Text[100]) { DataClassification = CustomerContent; }
        field(3; "Line Count"; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
