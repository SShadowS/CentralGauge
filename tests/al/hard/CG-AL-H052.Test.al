codeunit 80267 "CG-AL-H052 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestScopeAlone()
    var
        Acct: Record "CG H052 Account";
        Scope: Codeunit "CG H052 Tenant Scope";
    begin
        Scope.ApplyTenantScope(Acct, 'T1');
        Assert.AreEqual(2, Acct.Count, 'T1 alone matches A1 and A2.');
    end;

    [Test]
    procedure TestScopeIntersectsCallerStatusFilter()
    var
        Acct: Record "CG H052 Account";
        Scope: Codeunit "CG H052 Tenant Scope";
    begin
        Scope.ApplyTenantScope(Acct, 'T1');
        Acct.SetRange("Status", 'Active');
        Assert.AreEqual(1, Acct.Count, 'T1 AND Active = only A1.');
    end;

    [Test]
    procedure TestProtectedScopeBlocksTenantOverride()
    var
        Acct: Record "CG H052 Account";
        Scope: Codeunit "CG H052 Tenant Scope";
    begin
        Scope.ApplyTenantScope(Acct, 'T1');
        Acct.SetRange("Tenant Id", 'T2');
        Assert.AreEqual(0, Acct.Count, 'Caller cannot widen past the protected tenant; T1 AND T2 is empty.');
    end;

    [Test]
    procedure TestPreservesCallerPreAppliedProtectedFilter()
    var
        Acct: Record "CG H052 Account";
        Scope: Codeunit "CG H052 Tenant Scope";
    begin
        // Caller pre-applies a protected-slot filter on Status BEFORE handing the
        // record to ApplyTenantScope. The procedure must not wipe this filter when
        // adding its tenant restriction.
        Acct.FilterGroup(2);
        Acct.SetRange("Status", 'Active');
        Acct.FilterGroup(0);

        Scope.ApplyTenantScope(Acct, 'T1');

        // The intersection must still respect BOTH protected filters: Tenant=T1 AND Status=Active.
        // T1 has 2 rows (A1 Active, A2 Inactive). Intersected with Status=Active in the same
        // protected slot, only A1 remains.
        Assert.AreEqual(1, Acct.Count, 'Caller pre-applied protected Status=Active must survive; T1 AND Active = A1 only.');
    end;

    [Test]
    procedure TestUnknownTenant()
    var
        Acct: Record "CG H052 Account";
        Scope: Codeunit "CG H052 Tenant Scope";
    begin
        Scope.ApplyTenantScope(Acct, 'T99');
        Assert.AreEqual(0, Acct.Count, 'No row has T99.');
    end;
}
