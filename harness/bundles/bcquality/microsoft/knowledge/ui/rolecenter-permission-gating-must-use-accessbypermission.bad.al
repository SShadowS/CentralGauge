pageextension 50710 "Sample Bus. Mgr. RC Ext" extends "Business Manager Role Center"
{
    layout
    {
        addafter(Control16)
        {
            part(SampleMyCustomers; "My Customers")
            {
                ApplicationArea = Basic, Suite;
                // AL0573: procedure calls are not valid for client expressions.
                Visible = CanSeeMyCustomers();
            }
        }
    }

    // AL0569: a page of type Role Center cannot have procedures.
    local procedure CanSeeMyCustomers(): Boolean
    var
        Customer: Record Customer;
    begin
        exit(Customer.ReadPermission());
    end;
}
