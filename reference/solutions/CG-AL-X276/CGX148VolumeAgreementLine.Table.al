table 71321 "CG X148 Volume Agreement Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Agreement No."; Code[20]) { }
        field(2; "Zone Code"; Code[10]) { }
        field(3; "Customer No."; Code[20]) { }
        field(4; "Currency Code"; Code[10]) { }
        field(5; "Effective Date"; Date) { }
        field(6; Notes; Text[100]) { }
        field(7; "Rebate Group"; Code[10]) { }
    }

    keys
    {
        key(PK; "Agreement No.", "Zone Code")
        {
            Clustered = true;
        }
    }
}
