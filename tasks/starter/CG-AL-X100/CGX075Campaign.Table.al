table 70401 "CG X075 Campaign"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Target City"; Text[30]) { DataClassification = CustomerContent; }
        field(3; "Minimum Credit Limit"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
