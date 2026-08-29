table 71452 "CG X161 Zone Surcharge"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Carrier; Enum "CG X161 Carrier") { DataClassification = CustomerContent; }
        field(2; Zone; Code[10]) { DataClassification = CustomerContent; }
        field(3; Surcharge; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; Carrier, Zone) { Clustered = true; }
    }
}
