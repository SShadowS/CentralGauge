table 70200 "CGR Rental Contract"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; "Customer Name"; Text[100]) { }
        field(4; "Start Date"; Date) { }
        field(5; "End Date"; Date) { }
        field(6; Status; Enum "CGR Rental Status") { }
        field(7; "Start Km"; Integer) { }
        field(8; "Return Km"; Integer) { }
        field(9; "Damage Description"; Text[100]) { }
        field(10; "Pricing Method"; Enum "CGR Pricing Method") { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.") { }
    }
}
